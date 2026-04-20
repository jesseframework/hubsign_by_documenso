# Email-to-Sign Setup

The `/api/inbound/email-to-sign` endpoint accepts inbound emails from any provider and creates **DRAFT** signing requests for the matched org member.

## Required env

```
NEXT_PRIVATE_INBOUND_EMAIL_SECRET="long-random-string"
```

If this isn't set, the endpoint returns 503. If a request hits it without the matching `Authorization: Bearer <secret>` header, it returns 401.

## Provider setup

### Mailgun (recommended — current parser is Mailgun-shaped)

1. Add a route in Mailgun:
   - Match recipient: `^.+@inbox\.your-domain\.com$`
   - Forward action: `https://app.your-domain.com/api/inbound/email-to-sign`
   - Add custom header: `Authorization: Bearer <your secret>`
2. Set the MX records on `inbox.your-domain.com` to Mailgun's inbound MX servers.

### Postmark / SendGrid / SES inbound

The current parser reads `recipient`, `sender`, `subject`, and `attachment-1` form fields (Mailgun convention). For other providers, swap `parseMailgunPayload` in the handler with their field names. The rest of the pipeline is provider-agnostic.

## How it works

1. Email is sent to `<org-slug>@inbox.your-domain.com`
2. Provider forwards multipart to `/api/inbound/email-to-sign`
3. Handler:
   - Verifies the bearer secret
   - Looks up the org by the local-part of the To address
   - Verifies the sender is an org member (anti-spoofing)
   - Verifies the org has `emailToSignEnabled=true`
   - Saves the PDF attachment via `putPdfFileServerSide`
   - Creates a `Document` in `DRAFT` status owned by the matched member
4. Returns `{ ok: true, documentId, editUrl, message }` — your provider can use the `editUrl` in an automatic reply if you want.

## Org admin workflow

1. In Org Settings → toggle "Enable email-to-sign for this org" ON
2. Communicate the inbox alias to the team
3. Members forward PDFs → DRAFTs appear in their HubSign account → they finalize recipients/fields and send

## Security

- Secret-protected (returns 401 without)
- Only emails from existing org members are accepted (returns 403 otherwise)
- Email-to-sign must be explicitly enabled per-org
- DRAFT status means nothing is sent until a human reviews
