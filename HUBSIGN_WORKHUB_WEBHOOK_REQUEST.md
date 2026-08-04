# Request: Outbound Webhook for New Mail (WorkHub Inbox API)

## Who this is for
The WorkHub integrations/support team, from HubSign (a Documenso-based e-signature platform).

## What we're using today
We integrate with the WorkHub inbound email API (`GET /v1/email/inbox`, per-mailbox credential)
to pull new mail into our app for signature processing. Right now we **poll** this endpoint on a
timer. That works, but it means new mail can sit for up to our polling interval before it shows
up for our users — not instant.

## What we're asking for
Does WorkHub support an **outbound webhook** — a URL we register that WorkHub POSTs to the moment
new mail arrives in a mailbox — as an alternative or complement to the polling API? If so, we'd
like to switch to that for real-time delivery instead of polling.

## Our receiving endpoint (ready to configure once we know the details below)
```
POST https://<our-domain>/api/inbound/email-to-sign
Authorization: Bearer <a secret token we'll generate and share with you>
Content-Type: application/json
```

## Questions we need answered

1. **Does this feature exist?** Can we register a webhook URL — per mailbox, or account-wide —
   that fires when a new message arrives?

2. **Payload shape.** What's the exact JSON body you'd POST? Specifically the field names for:
   sender address, recipient/mailbox address, subject, and attachments.

3. **Attachments.** Would attachment content be included inline in the webhook payload (e.g.
   base64-encoded), or would we need to make a separate callback request to fetch it (similar to
   your existing `GET /v1/email/inbox/{id}/attachments/{id}` endpoint)? Inline is strongly
   preferred — it avoids a round-trip and lets us process the email immediately on receipt.

4. **Mailbox/account identification.** What field in the payload identifies which mailbox the
   message arrived in? We need this to map incoming mail back to the correct customer account on
   our side — we currently store a mailbox ID/credential per account.

5. **Authentication.** Can you send a custom `Authorization: Bearer <token>` header on the webhook
   request (a static secret we provide), or do you use a different verification mechanism (e.g.
   HMAC request signing)? We need some way to verify a request genuinely came from WorkHub.

6. **Setup process.** Is webhook registration self-serve in your dashboard, or does it need to be
   enabled by your support team per account/mailbox?

7. **Delivery behavior.** Do you retry on a failed/timed-out delivery? Is delivery at-least-once
   (i.e., should we expect and safely handle occasional duplicate deliveries)?

8. **One unrelated question while we're in touch:** is there a rate limit on the existing
   `GET /v1/email/inbox` polling endpoint? We're increasing our poll frequency (to roughly every
   20 seconds per mailbox) as a stopgap for faster delivery while webhook support gets sorted out,
   and want to make sure that's within acceptable limits.

## Once we have answers
We'll register the webhook URL above with the token we generate, and can adjust our polling
frequency down (or turn it off entirely) once webhook delivery is confirmed working.

Thanks!
