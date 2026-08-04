# License-Key Activation — Strawman Design

_Discovery doc, not a final spec. Written 2026-07-09 after reviewing `hub-forge-framwork`'s
existing product-key system as a reference. Several decisions are flagged as open below —
confirm with the WorkHub team before treating this as buildable._

## The ask
A Stripe-free way to hand someone (a prospect, an evaluator) a key that activates HubSign's paid
features for a fixed number of days — similar to how another CodeFusionLabs project, WorkHub
(built on `hub-forge-framwork`), already does this.

## Reference: how `hub-forge-framwork` actually does it
Read directly from its source (`apps/api/src/workspaces/license-key.ts` +
`license-key.test.ts`), not guessed:

- A **mint** endpoint (`POST /:id/license-keys/mint`, gated `platform.admin`-only — deliberately
  *not* self-service even for a workspace owner, per its own comment: "or they could self-issue
  free upgrades") takes `{ tier, days, redeemableForDays?, jti? }` and produces a compact signed
  token:
  ```
  BMS1.<base64url(payload)>.<base64url(hmac-sha256)>
  payload = { v: 1, tier, days, jti, exp }
  ```
  - `tier` — plan tier the key grants; the redeeming app validates the value itself.
  - `days` — the term granted *once redeemed*: `period_end = redeemedAt + days`.
  - `exp` — a separate "redeem-by" deadline (default 90 days from mint) — the key itself expires
    if nobody ever uses it, independent of the `days` term it grants once redeemed.
  - `jti` — a unique id the redeeming app must track to enforce single-use.
- The signing secret (`LICENSE_KEY_SECRET`) is shared out-of-band between the minting platform
  and the consuming app. Verification is pure local HMAC + expiry check — **no live call back to
  the platform**. That's the core design win: it works fully offline / self-hosted, with no
  ongoing network dependency between issuer and redeemer.
- The platform side only mints and audits (`tier`/`days`/`jti` are logged; the raw key and the
  secret never are). **Verification, single-use tracking, and actually applying the tier/term to
  local billing state is entirely the consuming app's own job** — hub-forge-framework doesn't do
  that part itself. A sibling app ("bms-erp") implements its own verifier; that code isn't
  available in this repo, only the wire format, which is pinned by a golden-vector test so it
  can't silently drift.

## Mapping onto HubSign
HubSign would need to be **both sides at once** (self-hosted, not managed by a separate
multi-tenant platform) — a self-contained mint+redeem pair, using the same proven crypto scheme
so that pointing at hub-forge-framework's actual minter later (if that integration ever happens)
would mean swapping where the secret/mint UI lives, not rearchitecting anything.

**Schema** — new Prisma model:
```prisma
model OrgLicenseKeyRedemption {
  id             String       @id @default(cuid())
  jti            String       @unique // enforces single-use at the DB level
  organizationId Int
  organization   Organization @relation(fields: [organizationId], references: [id])
  tier           OrgSeatTier
  days           Int
  redeemedAt     DateTime     @default(now())
  expiresAt      DateTime
  redeemedById   String       // OrganizationMember.id
}
```
Extend `OrgSeatPlan` with `source String @default("stripe")` (`"stripe" | "license_key"`) and an
`expiresAt DateTime?` — this reuses the existing tier/limits machinery (`ORG_SEAT_TIERS`,
`getOrgSeatLimits`) rather than inventing a second, parallel entitlement system.

**Server** (`packages/lib/server-only/license/` — new):
- `mintLicenseKey` / `verifyLicenseKey` — the same HMAC/base64url scheme as above, own version
  tag (e.g. `HUB1`, since this wouldn't literally be "bms-erp").
- `LICENSE_KEY_SECRET` env var, generated once.
- **Mint**: superadmin-only (`user.roles.includes('ADMIN')`) — never org-admin, matching
  hub-forge-framework's rationale exactly (an org admin must not be able to self-issue their own
  free upgrade).
- **Redeem**: an org-admin-facing mutation — verify signature + `exp`, reject if `jti` was
  already redeemed (unique constraint), upsert `OrgSeatPlan` for the tier with
  `source: 'license_key'` and `expiresAt = now + days`.
- **Expiry**: the org seat limits resolver needs to check `expiresAt` and fall back to free-plan
  limits once it passes (fail-closed), plus a proactive daily sweep (reusing the existing
  renewal-reminder cron pattern) rather than relying only on lazy on-read checks.

**UI**: a superadmin "mint a key" tool, and a "Redeem license key" input on the org billing page,
showing key-activated tiers distinctly from normally Stripe-billed ones (e.g. "Trial active until
<date>").

## Open questions — confirm before this becomes a real plan
1. **Org-scoped or generic keys?** hub-forge-framework's mint is workspace-*scoped* at mint time
   (tied to one tenant, not portable). Does HubSign need the same (mint *for* a specific
   prospect's org), or a generic single-use code redeemable by whichever org uses it first (e.g.
   a conference giveaway code)?
2. **What quantity/seat count does a trial grant?** A key activates a *tier*, but `OrgSeatPlan`
   also needs a `quantity`. The tier's minimum? Effectively unlimited for the trial term?
   Something else?
3. **Does "test the full suite of packages" mean unlocking a seat tier** (Business/Enterprise, as
   modeled above), **or something broader** — e.g. also flipping on DMS/AI features independently
   of seat tier, closer to hub-forge-framework's generic `features: string[]` entitlements list
   than a single `tier` enum? This changes the payload shape.
4. Does this need to actually interoperate with hub-forge-framework's real minter (HubSign
   becomes an "app" it manages), or stay fully self-contained inside HubSign? Determines whether
   to literally reuse hub-forge's `BMS1` tag/secret-sharing setup, or mint an independent scheme
   as sketched here.
