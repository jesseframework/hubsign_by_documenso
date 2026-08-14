# Request: AI Bridge Access for HubSign (`/v1/integrations/ai/invoke`)

> **STATUS: ANSWERED AND IMPLEMENTED (2026-08-13).** WorkHub said yes to all ten
> questions (platform api `a83cb5d8`): `ai.invoke` scope on a `whk_` key, a new
> `chat` operation with native tool calling, per-call `model`/`vendor` pins, a
> **passive** platform meter that can never refuse a HubSign call, a distinct
> `upstream_ai_unavailable` code, and `ai-credits/verify`. HubSign side is built —
> see `packages/lib/server-only/ai/bridge.ts`, now the only outbound AI call in
> the repo. **Remaining to go live: WorkHub mints the `ai.invoke` key and we set
> `WORKHUB_AI_API_KEY`.** Kept below as the record of what was agreed.

## Who this is for
The WorkHub platform/integrations team, from HubSign (a Documenso-based e-signature and
invoice-processing platform).

## What we want
The same thing BMS ERP already has: **HubSign holds no model key at all.** Every AI call leaves
HubSign as one HTTP request to WorkHub, WorkHub decrypts the shared provider key server-side and
calls the vendor. The operator rotates one key on the platform and never touches a HubSign
deployment.

We've read `PLATFORM_REQUEST_AI_INTEGRATION.md` and the BMS integration write-up. We want to be a
second consumer of the exact same bridge. Two things stand in the way, and both need a decision
from you.

## Where we are today
HubSign calls `https://api.openai.com/v1/chat/completions` directly from three places, holding
`NEXT_PRIVATE_OPENAI_API_KEY` in each deployment's environment:

| Call site | Model | Shape | What it does |
|---|---|---|---|
| `aubrey/agent.ts` | `gpt-4o` | **Native function calling** — 11 tools, `tool_choice: "auto"`, up to 6 round trips feeding `role:"tool"` results back, then a forced final text turn | Aubrey, our agentic assistant |
| `workflow/ai-generate-workflow.ts` | `gpt-4o` (Anthropic fallback path exists) | **One forced function call** used purely as structured output (`tool_choice: {type:"function", …}`) | Generate a workflow definition from a prompt |
| `dms-ai/agent.ts` | `gpt-4o-mini` | Plain chat completion, **no tools** | DMS document chat |

All three are live. We'd retire our OpenAI key entirely.

---

## Gap 1 — HubSign has no WorkHub identity

`/v1/integrations/ai/invoke` requires `X-WorkHub-Identity`: either a 60-second workspace identity
JWT (from the SDK's `ctx.integrations`, only available inside a workspace app) or
`WORKHUB_AI_SERVICE_TOKEN` (minted per workspace+tenant at `workspace-deploy`).

**HubSign is external to WorkHub.** We are not a deployed workspace app, we don't use the app
backend SDK, and we have no tenant id anywhere in our data model. We authenticate to you two ways
today:

- **HMAC-signed keys** POSTed to `/v1/public/hubsign/license/{redeem,verify}` and
  `/v1/public/hubsign/ai-credits/redeem` — no bearer credential, IP-allowlisted to our egress.
- **`whk_…` API keys** with scopes (`email.read`, `email.update`) on `/v1/email/inbox/…`, stored
  **per organization** in our database.

### What we're asking
Pick whichever is less work for you:

- **(a) Extend the API-key path.** Let a `whk_…` key with a new scope — `ai.invoke` or `ai.use` —
  authenticate `/v1/integrations/ai/invoke`. This is our preference: we already store these keys
  per org, so per-org attribution and revocation come for free.
- **(b) Mint us a service token.** Issue HubSign a long-lived AI service token like BMS's, outside
  the `workspace-deploy` path. Workable, but it's one token for the whole deployment, so you lose
  per-org attribution unless we pass an org identifier in the body.

### Questions
1. Which do you prefer, and can either be done without making HubSign a deployed workspace app?
2. The route sets the tenant RLS GUC (`app.tenant_id`) and `meterAiUsage` keys on `tenantId` +
   `appKey`. **What is HubSign's tenant?** We have no tenant id. Our AI-credit packs are pinned to
   a `subject` that is a HubSign org id string — can that be the mapping key, and do you need us
   to register those orgs with you first?
3. Does the AI invoke endpoint need the same egress IP allowlisting as the license endpoints?

---

## Gap 2 — `assist` can't carry tool calls

`assist` is `{ prompt, system?, maxTokens? }` → `{ text, usage }`. Text in, text out. It cannot
carry a `messages[]` array, a `tools[]` array, `tool_choice`, or `role:"tool"` results, and it
returns no `tool_calls`.

BMS worked around this by making its agentic loop a **local JSON tool loop** — the model emits
JSON, the ERP parses it, one `assist` per step. HubSign's Aubrey instead uses **native OpenAI
function calling**, which is a materially different contract: the tool schema is validated by the
provider, arguments come back as structured JSON rather than parsed out of prose, and the loop
doesn't break when the model decides to write a sentence before its JSON.

### What we're asking
A **tool-calling operation** on the bridge. Rough shape:

```
POST {WORKHUB_API_URL}/v1/integrations/ai/invoke
{
  "operation": "chat",
  "input": {
    "messages":    [ { "role": "system"|"user"|"assistant"|"tool", "content": …,
                       "tool_calls": […], "tool_call_id": "…" } ],
    "tools":       [ { "name": "…", "description": "…", "parameters": { …JSON Schema… } } ],
    "toolChoice":  "auto" | { "name": "…" },
    "maxTokens":   4000,
    "temperature": 0.3
  }
}
→ { "ok": true, "data": { "content": "…"|null,
                          "toolCalls": [ { "id": "…", "name": "…", "arguments": "…" } ],
                          "usage": { "input": n, "output": n } } }
```

The loop stays on our side, exactly as the ERP's does — we'd only ever ask you to run one turn at
a time. Your existing `openai.ts` / `anthropic.ts` split already normalises text across vendors;
this asks it to normalise tool calls too (OpenAI `tools`/`tool_calls` vs Anthropic
`input_schema`/`tool_use`).

`sendMessage` doesn't substitute — it runs the *platform's* tool loop with `permissions: []`, and
our 11 tools are HubSign-side queries the platform has no access to.

### Questions
4. Can you add a tool-calling operation? If not, we'll rewrite Aubrey as a JSON loop on `assist`
   like BMS did — we'd rather know now, because it's a real rewrite and a reliability downgrade.
5. `BRIDGE_TIMEOUT_MS` is 75s per call in BMS. Aubrey can make up to 7 sequential calls in one
   turn. Is 75s per invoke, and is there a separate cap on a single request we should design to?
6. **Can we pin a vendor per app or per operation?** Aubrey's system prompt asks for HTML output
   and its tool loop is OpenAI-shaped; the write-up says the active shared provider decides, and
   migration 206 seeds Anthropic. If we can't pin, we need to know the target vendor up front so
   we write to it.
7. Same question for the model: we currently choose `gpt-4o` for Aubrey and `gpt-4o-mini` for DMS
   chat, a deliberate cost split. Can `input.model` (or an `agentId`) select that, or is it fixed
   by the shared agent's `model` column?

---

## Gap 3 — two credit meters, and which one says no

This one matters more than it looks. Today:

- **WorkHub** mints AI credit packs; HubSign redeems them at
  `/v1/public/hubsign/ai-credits/redeem` and holds the balance locally (1 credit = 1 message).
- **We** enforce that balance before every call.
- **You** would meter platform-side too (`meterAiUsage`, per tenant + appKey) once we're on the
  bridge.

Two ledgers, two places a call can be refused. We just shipped a fix for exactly this failure mode
in miniature: our OpenAI account ran dry and the provider's "you have no credits remaining" text
reached a user who had just bought 500 HubSign credits. We do not want to rebuild that with
platform entitlement as the second source of truth.

### Questions
8. **Will `/v1/integrations/ai/invoke` refuse when platform-side entitlement is exhausted, even
   though the HubSign org has credits?** If yes, we need a distinct machine-readable error code
   for it so we can tell an admin "the platform account needs topping up" rather than "you're out
   of credits".
9. Do you want to become the meter of record? If HubSign is on the bridge, the pack you sold and
   the inference you run are finally in the same system — you could enforce the balance at invoke
   time and we'd stop keeping a local one. We're open to either; we just need one authority.
10. Either way: **is there an `ai-credits/verify` (or status) endpoint**, mirroring
    `license/verify`? Credits are redeem-only today. If our database is restored from a backup
    taken before a redemption, that pack is unrecoverable — a re-redeem returns `already_redeemed`
    and we have no way to ask what the key granted. Please also include the `subject` in the
    `already_redeemed` response so we can distinguish "we already applied this" from "spent
    elsewhere", and tell us whether packs carry an expiry (nothing in HubSign models one, so if
    they expire, every balance we display is wrong).

---

## What we'll do on our side once you answer

- Replace the three direct `fetch('https://api.openai.com/…')` calls with a single
  `bridgeCall()`-equivalent module, and delete `NEXT_PRIVATE_OPENAI_API_KEY` and
  `NEXT_PRIVATE_ANTHROPIC_API_KEY` from all deployments.
- Keep the Aubrey and workflow-generator loops HubSign-side; only the model call crosses.
- Map bridge error codes to admin-facing messages, keeping the provider's own wording out of the
  user's view.
- If you can't add tool calling, rewrite Aubrey's loop against `assist` in the BMS style.

---

# Follow-up request: streaming responses (2026-08-13)

The bridge is live and working — thank you. One gap surfaced immediately in real use.

## The problem
`chat` returns the complete answer in a single JSON body. For a one-line reply that's fine. For
Aubrey — which runs a tool loop and can take ten seconds or more across several turns — the user
stares at a spinner and then the whole answer appears at once. Every assistant they've used streams,
so it reads as broken.

## What we probed
We tried the obvious shapes against the live endpoint before asking:

| Attempt | Result |
|---|---|
| `input.stream: true` | `200`, single JSON body — **silently ignored** |
| top-level `stream: true` | `200`, single JSON body — ignored |
| `operation: "chatStream"` | `400 unknown_operation` (`ai.chatStream`) |

Note the first two: an unknown key in `input` is accepted and dropped. A caller who assumes
streaming works gets no signal that it didn't. Rejecting unknown `input` keys would be a kindness.

## What we're asking for
Server-sent events from the same endpoint when the caller opts in — ideally
`Accept: text/event-stream` plus `input.stream: true`, falling back to the current single-body
behaviour when either is absent, so nothing existing breaks.

```
POST /v1/integrations/ai/invoke
Accept: text/event-stream
{ "operation": "chat", "input": { …, "stream": true } }

→ Content-Type: text/event-stream
event: delta      data: { "content": "Every " }
event: delta      data: { "content": "invoice " }
event: tool_calls data: { "toolCalls": [ { "id": "…", "name": "…", "arguments": "…" } ] }
event: done       data: { "usage": { "input": n, "output": n }, "model": "…", "vendor": "…" }
event: error      data: { "error": "upstream_ai_unavailable", "detail": "…" }
```

Both vendor SDKs you already dispatch to support streaming natively (OpenAI SSE deltas, Anthropic
`content_block_delta`), so we're asking you to normalise the stream the same way you already
normalise tool calls.

### Questions
11. Can you add opt-in SSE? If it's on a roadmap, a rough horizon is enough — we'll build an interim
    experience against the non-streaming path and swap it out.
12. When a turn ends in tool calls rather than text, we'd want `tool_calls` as a single terminal
    event rather than streamed fragments — partial JSON arguments aren't useful to us. Does that
    match how you'd implement it?
13. Does the per-key rate limit treat a streamed call the same as a non-streamed one?
14. Unrelated but adjacent: would you consider **rejecting unknown keys in `input`** with
    `invalid_input` rather than dropping them? Silent acceptance cost us a debugging cycle.

## Contact
HubSign engineering — reply on this document or to the usual integrations channel.
