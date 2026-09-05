# Aubrey AI — Credits & WorkHub Integration

How Aubrey AI is metered today, and the exact WorkHub API you need to stand up so
organizations can **buy AI credits** (the same single-use key model as licenses).

---

## Two things to know

1. **The test admin (`admin@documenso.com`) is allowlisted as _unlimited_**, so you can
   chat with Aubrey freely right now without touching credits. To exercise the
   credit / redeem flow end-to-end, sign in as a **non-allowlisted member**.

2. **Redeeming a credit key needs WorkHub to expose
   `POST /v1/public/hubsign/ai-credits/redeem`.** HubSign is already wired to call it
   (`WORKHUB_LICENSE_API_URL` points at `https://api.workhubplatform.io`). Until that
   endpoint exists on WorkHub's side, redemption returns a friendly error — but
   **chatting works now** via the monthly free allotment because the OpenAI key is
   configured.

---

## How metering works

**1 credit = 1 message.** Every chat message spends one credit, drawn in this order:

1. **Monthly free allotment** — _per user_. Resets each calendar month. Default **20**
   messages/user/month (`NEXT_PRIVATE_AUBREY_FREE_CREDITS_PER_MONTH`). Tracked in
   `DmsAiUsage.totalQueries`.
2. **Purchased pool** — _per organization, shared_. Once a user's monthly free
   allotment is exhausted, their messages draw from the org's shared balance
   (`AiCreditBalance.balance`). This is the pool that WorkHub credit packs top up.

When both are empty, Aubrey refuses the message and prompts an **ORG_ADMIN** to redeem
a pack.

### Relevant env vars (HubSign side)

| Var | Purpose | Current |
| --- | --- | --- |
| `NEXT_PRIVATE_OPENAI_API_KEY` | Powers Aubrey (gpt-4o) | set |
| `NEXT_PRIVATE_AUBREY_MODEL` | Model id | `gpt-4o` |
| `NEXT_PRIVATE_AUBREY_FREE_CREDITS_PER_MONTH` | Monthly free messages/user (`unlimited`/`0`/`-1` lifts the cap) | `20` |
| `NEXT_PRIVATE_AUBREY_UNLIMITED_USERS` | Comma-separated emails/user-ids with an unlimited cap | `admin@documenso.com` |
| `WORKHUB_LICENSE_API_URL` | WorkHub API base for **license + AI-credit** redemption (no trailing path) | `https://api.workhubplatform.io` |

---

## The endpoint to build on WorkHub

> `POST {WORKHUB_LICENSE_API_URL}/v1/public/hubsign/ai-credits/redeem`

This mirrors the existing license redeem endpoint (`/v1/public/hubsign/license/redeem`).
It is **public** (no HubSign-held secret): HubSign posts a WorkHub-minted key, and
WorkHub verifies it, consumes it (single-use), and returns how many credits it grants.

### Security model (same as licenses)

- The **key** is minted and HMAC-signed by WorkHub. HubSign never holds the signing
  secret — it only relays the key.
- WorkHub enforces **global single-use** (its own ledger) and **pins the subject** (the
  organization id) so a key issued for org A cannot be redeemed by org B.
- WorkHub should **IP-allowlist** this endpoint to HubSign's egress IP.
- Key prefix convention: licenses use `HSGN1…`; **AI-credit packs use `HSAI1…`** (this
  is only the UI placeholder — WorkHub decides the real format).

### Request

Headers:

```
Content-Type: application/json
Accept: application/json
```

Body:

```json
{
  "key": "HSAI1-XXXX-XXXX-XXXX",
  "subject": "42"
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `key` | string | The single-use credit-pack key the customer purchased. |
| `subject` | string | The **organization id** (as a string). WorkHub must reject if the key was pinned to a different subject. |

### Success response — `200 OK`

```json
{
  "valid": true,
  "jti": "wh_credit_01HZY…",
  "subject": "42",
  "credits": 500
}
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `valid` | boolean | ✅ | Must be exactly `true`. Anything else is treated as an error. |
| `jti` | string | ✅ | Globally-unique key id. HubSign stores it `@unique` for idempotency — **must be stable per key**. |
| `subject` | string | ✅ | Echo of the org id. |
| `credits` | number | ✅ | Integer > 0. Added to the org's shared pool. A non-number or ≤ 0 is rejected by HubSign as `bad_response`. |

### Error response — non-2xx (or `valid: false`)

```json
{
  "valid": false,
  "error": "already_redeemed",
  "detail": "This credit pack was already redeemed on 2026-08-10."
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `valid` | boolean | `false`. |
| `error` | string | Machine code (see table below). HubSign maps it to a friendly message. |
| `detail` | string | Optional human-readable detail; shown if `error` isn't a known code. |

#### Error codes HubSign understands

| `error` code | HTTP | Message shown to the user |
| --- | --- | --- |
| `invalid_key` | 400 | That credit key is not valid. |
| `subject_mismatch` | 403 | That key was issued for a different organization. |
| `already_redeemed` | 409 | That credit key has already been used. |
| `revoked` | 403 | That credit key has been revoked. |
| `unknown_key` | 404 | That credit key is not recognised. |
| _(anything else)_ | — | Falls back to `detail`, or `http_<status>`. |

Additional codes HubSign generates **client-side** (you don't return these, but good to
know): `not_configured` (env unset), `unreachable` (network/DNS), `bad_response`
(non-JSON body or bad `credits`).

> **Contract rule:** HubSign treats the call as failed if the HTTP status is non-2xx
> **or** the JSON body's `valid` is not exactly `true`. A non-JSON body (e.g. an HTML
> 502 page) becomes `bad_response`. Always return JSON.

---

## Reference implementation sketch (WorkHub side)

```
POST /v1/public/hubsign/ai-credits/redeem
  { key, subject } = request.body

  # 1. Verify signature — reject tampered/foreign keys
  claims = verifyHmac(key, WORKHUB_SIGNING_SECRET)      # else 400 invalid_key
  if claims.type != "ai_credits":        return 400 { valid:false, error:"invalid_key" }

  # 2. Pin the subject (organization id)
  if claims.subject != subject:          return 403 { valid:false, error:"subject_mismatch" }

  # 3. Revocation + single-use (WorkHub's own ledger)
  if isRevoked(claims.jti):              return 403 { valid:false, error:"revoked" }
  if alreadyRedeemed(claims.jti):        return 409 { valid:false, error:"already_redeemed" }
  markRedeemed(claims.jti, subject)      # atomic — this is the single-use gate

  # 4. Grant
  return 200 {
    valid:   true,
    jti:     claims.jti,
    subject: subject,
    credits: claims.credits,             # e.g. 100, 500, 1000
  }
```

`claims.credits` is whatever the pack was minted with — that integer is added to the
org's pool verbatim. So "credit pack SKUs" (100 / 500 / 1000 messages) are simply keys
minted with different `credits` values.

### curl to test once it's live

```bash
curl -sS -X POST \
  https://api.workhubplatform.io/v1/public/hubsign/ai-credits/redeem \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json' \
  -d '{"key":"HSAI1-XXXX-XXXX-XXXX","subject":"42"}'
```

---

## What happens on the HubSign side after a 200

1. `redeemAiCredits()` verifies the caller is an **ORG_ADMIN** of the subject org.
2. In one transaction it **increments `AiCreditBalance.balance`** by `credits` and writes
   an `AiCreditRedemption` ledger row keyed on `jti` (so a duplicate call is a no-op —
   HubSign's local idempotency backstop on top of WorkHub's global single-use).
3. The org billing page + the Aubrey credit meter immediately reflect the new balance.

**HubSign files involved** (for reference):
`packages/lib/server-only/aubrey/workhub-credits-client.ts` (the HTTP call),
`packages/lib/server-only/aubrey/redeem-ai-credits.ts` (guards + ledger),
`packages/trpc/server/aubrey-router/router.ts` (`redeemCredits` procedure).
