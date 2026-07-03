# WorkHub Inbox API — `mailbox_profile_missing` on `host.support@hostzones.net`

**Reported by:** HubSign integration team
**Date:** 2026-06-22
**Severity:** Blocking — cannot read inbox messages for the mailbox
**Environment:** Production — `https://api.workhubplatform.io/v1`

---

## Summary

We are integrating HubSign with the WorkHub inbound email API to pull PDFs
emailed to a shared mailbox for e‑signature. Authentication (API key) works and
the mailbox is listed correctly, but **listing inbox messages fails** because the
mailbox has no saved proxy profile.

- ✅ API key is valid and authorized.
- ✅ `GET /email/mailboxes` returns the target mailbox.
- ❌ `GET /email/inbox?mailboxId=...` returns **HTTP 409 `mailbox_profile_missing`**.

The error states `mailbox.proxy_profile_id is null`, so this appears to be a
**mailbox‑provisioning gap on the WorkHub side**, not a client or scope problem.

---

## Affected mailbox

| Field | Value |
|---|---|
| `id` (mailboxId) | `475fb43d-f1b5-4231-aed5-368b833a4ecc` |
| `primaryEmail` | `host.support@hostzones.net` |
| `msUserPrincipalName` | `host.support@hostzones.net` |
| `msUserId` | `null` ← appears unlinked to a backing account |
| `status` | `active` |
| `tenantId` | `48ad0404-846f-4ee1-a135-953172f458eb` |
| `proxy_profile_id` | `null` (per error detail) |

Auth: `x-api-key` (production key, `whk_…`, scope includes inbox read).

---

## Reproduction

> Replace `$KEY` with the production API key issued to us.

### 1. List mailboxes — works (HTTP 200)

```bash
curl -s -H "x-api-key: $KEY" \
  "https://api.workhubplatform.io/v1/email/mailboxes"
```

Response (trimmed) — the mailbox is present and `active`:

```json
{
  "items": [
    {
      "id": "475fb43d-f1b5-4231-aed5-368b833a4ecc",
      "primaryEmail": "host.support@hostzones.net",
      "msUserPrincipalName": "host.support@hostzones.net",
      "msUserId": null,
      "status": "active",
      "tenantId": "48ad0404-846f-4ee1-a135-953172f458eb"
    }
  ]
}
```

### 2. List inbox for that mailbox — fails (HTTP 409)

```bash
curl -s -H "x-api-key: $KEY" \
  "https://api.workhubplatform.io/v1/email/inbox?isRead=false&hasAttachments=true&maxResults=5&mailboxId=475fb43d-f1b5-4231-aed5-368b833a4ecc"
```

Response:

```json
{
  "error": "mailbox_profile_missing",
  "detail": "mailbox.proxy_profile_id is null — explicit-mailbox access requires a saved proxy profile"
}
```

### (For reference) Inbox without `mailboxId` — HTTP 409

API‑key callers must pass `mailboxId` explicitly (we do; included for completeness):

```json
{
  "error": "sender_required",
  "detail": "no mailboxId and no caller userId — API-key callers must pass mailboxId explicitly"
}
```

---

## What we need from the WorkHub team

Please provision/complete the backing mail connection for the mailbox so that
`proxy_profile_id` is set and API‑key callers can read it:

1. **Link the mailbox to its backing account.** `msUserId` is `null`, which
   suggests `host.support@hostzones.net` is not yet connected to its Microsoft
   365 / Exchange (or other) backend. Completing that connection should populate
   the proxy profile.
2. **Ensure a saved proxy profile exists** for the mailbox
   (`proxy_profile_id` non‑null) so explicit‑mailbox (`mailboxId=…`) access is
   permitted for API‑key callers.
3. Confirm the production API key issued to us is **scoped to read this
   mailbox** (`email.read` on `475fb43d-f1b5-4231-aed5-368b833a4ecc`).

### Endpoints our integration uses (all under `/email/…`)

So the same profile/scope needs to cover the full read + mark‑read flow:

| Method | Path | Purpose |
|---|---|---|
| GET | `/email/mailboxes` | resolve mailbox |
| GET | `/email/inbox?mailboxId=…` | list messages |
| GET | `/email/inbox/{id}/attachments?mailboxId=…` | list attachments |
| GET | `/email/inbox/{id}/attachments/{aid}?mailboxId=…` | download attachment |
| POST | `/email/inbox/{id}/mark-read?mailboxId=…` | mark read (write; optional but preferred) |

---

## Acceptance criteria

The issue is resolved when **reproduction step 2 returns HTTP 200** with a JSON
list of messages (e.g. `{ "items": [...] }` or `{ "messages": [...] }`) for
mailbox `475fb43d-f1b5-4231-aed5-368b833a4ecc`, using the production API key.

---

## Contact

HubSign integration — reply on this thread once the mailbox proxy profile is
provisioned and we'll re‑test end to end.
