# WorkHub Email API — Implementation Guide

This document describes the WorkHub email APIs used by this application and
how to implement them from scratch in **Node.js**, **PHP**, and **C#**. It
reflects the actual integration in this codebase:

| API | Direction | Used for | Implementation |
|---|---|---|---|
| **BulkSender** (`POST /v1/bulk-send`) | Outbound | All transactional email sent by the app (invites, signing requests, notifications) | [`packages/email/transports/workhub.ts`](../packages/email/transports/workhub.ts) |
| **Inbox API** (`/v1/email/...`) | Inbound | Polling an org's shared mailbox for "email-to-sign" PDFs | [`packages/lib/server-only/inbox/workhub-inbox-client.ts`](../packages/lib/server-only/inbox/workhub-inbox-client.ts), [`poll-workhub-inbox.ts`](../packages/lib/server-only/inbox/poll-workhub-inbox.ts) |

Base URL for both APIs: `https://api.workhubplatform.io/v1`

For how inbound mail reaches this app's own webhook (`/api/inbound/email-to-sign`),
see [`email-to-sign-setup.md`](./email-to-sign-setup.md). This document is about
talking to **WorkHub's** API directly.

---

## 1. Authentication

WorkHub credentials are issued per **BulkSender** from the WorkHub portal:
`Email → Bulk Senders → {sender} → Credentials`.

Two schemes are supported, and both APIs accept either:

| Scheme | Header | Used for |
|---|---|---|
| HTTP Basic | `Authorization: Basic base64(username:password)` | Sending (`/bulk-send`); fallback for inbox reads |
| API key | `x-api-key: <key>` | Preferred for the Inbox API |

This app stores credentials as environment variables (outbound, single
BulkSender for the whole app) and per-organization database columns (inbound,
one mailbox per org):

```
# Outbound (packages/email/mailer.ts)
NEXT_PRIVATE_SMTP_TRANSPORT=workhub
NEXT_PRIVATE_WORKHUB_USERNAME=<bulksender-username>
NEXT_PRIVATE_WORKHUB_PASSWORD=<bulksender-password>
NEXT_PRIVATE_WORKHUB_ENDPOINT=https://api.workhubplatform.io/v1/bulk-send   # optional override
```

```
# Inbound (per-org, Organization table columns — see org-router)
workhubApiKey        # preferred
workhubUsername       # fallback, paired with workhubPassword
workhubPassword
workhubMailboxId      # UUID, or an email resolved via /email/mailboxes
workhubApiBase         # optional override, defaults to https://api.workhubplatform.io/v1
```

> The `from` address is **not** sent to the API — the sending mailbox is bound
> server-side to the BulkSender credential, so whatever mailbox the credential
> belongs to is who the mail comes from.

---

## 2. Outbound — Send Email (`POST /v1/bulk-send`)

### Request

```
POST https://api.workhubplatform.io/v1/bulk-send
Content-Type: application/json
Authorization: Basic <base64(username:password)>
```

```json
{
  "to": ["recipient@example.com"],
  "cc": ["cc@example.com"],
  "bcc": ["bcc@example.com"],
  "replyTo": ["reply@example.com"],
  "subject": "Please review and sign",
  "htmlBody": "<p>Hello — please sign the attached document.</p>",
  "textBody": "Hello — please sign the attached document.",
  "importance": "Normal",
  "attachments": [
    {
      "fileName": "contract.pdf",
      "contentBase64": "JVBERi0xLjQK...",
      "mimeType": "application/pdf",
      "isInline": false,
      "contentId": null
    }
  ]
}
```

Field notes:
- `to` is required and must be non-empty; everything else is optional.
- `importance` is one of `"Low" | "Normal" | "High"`.
- `attachments[].contentBase64` is the raw file content, base64-encoded (no `data:` prefix).
- `isInline` / `contentId` are for inline images referenced from `htmlBody` via `cid:`.

### Success response (HTTP 2xx)

```json
{
  "ok": true,
  "sentAt": "2026-07-20T14:32:01.000Z",
  "exchangeItemId": "AAMkAGI...",
  "bulkSendEventId": "6f2a1c3e-...",
  "monthlyUsed": 1204,
  "monthlySendLimit": 50000
}
```

### Error response (non-2xx)

```json
{
  "error": "rate_limited",
  "message": "Monthly send limit exceeded",
  "detail": { "monthlyUsed": 50000, "monthlySendLimit": 50000 }
}
```

A `Retry-After` response header may be present on throttling errors.

### Node.js example

```js
async function sendWorkHubEmail({ username, password, endpoint, ...mail }) {
  const basic = Buffer.from(`${username}:${password}`).toString('base64');

  const res = await fetch(endpoint ?? 'https://api.workhubplatform.io/v1/bulk-send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${basic}`,
    },
    body: JSON.stringify(mail),
  });

  const data = await res.json().catch(() => ({}));

  if (res.status < 200 || res.status > 299) {
    const code = data.error ?? `http_${res.status}`;
    const detail = data.message ?? '';
    throw new Error(`WorkHub BulkSender error [${code}]: ${detail}`);
  }

  return data; // { ok, sentAt, bulkSendEventId, ... }
}

await sendWorkHubEmail({
  username: process.env.WORKHUB_USERNAME,
  password: process.env.WORKHUB_PASSWORD,
  to: ['recipient@example.com'],
  subject: 'Please review and sign',
  htmlBody: '<p>Hello — please sign the attached document.</p>',
  attachments: [
    {
      fileName: 'contract.pdf',
      contentBase64: require('fs').readFileSync('contract.pdf').toString('base64'),
      mimeType: 'application/pdf',
    },
  ],
});
```

### PHP example

```php
<?php

function sendWorkHubEmail(string $username, string $password, array $mail, ?string $endpoint = null): array
{
    $endpoint = $endpoint ?? 'https://api.workhubplatform.io/v1/bulk-send';
    $basic = base64_encode("$username:$password");

    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            "Authorization: Basic $basic",
        ],
        CURLOPT_POSTFIELDS => json_encode($mail),
    ]);

    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $data = json_decode($body, true) ?? [];

    if ($status < 200 || $status > 299) {
        $code = $data['error'] ?? "http_$status";
        $detail = $data['message'] ?? '';
        throw new RuntimeException("WorkHub BulkSender error [$code]: $detail");
    }

    return $data; // ['ok' => true, 'sentAt' => ..., 'bulkSendEventId' => ...]
}

sendWorkHubEmail(
    getenv('WORKHUB_USERNAME'),
    getenv('WORKHUB_PASSWORD'),
    [
        'to' => ['recipient@example.com'],
        'subject' => 'Please review and sign',
        'htmlBody' => '<p>Hello — please sign the attached document.</p>',
        'attachments' => [
            [
                'fileName' => 'contract.pdf',
                'contentBase64' => base64_encode(file_get_contents('contract.pdf')),
                'mimeType' => 'application/pdf',
            ],
        ],
    ],
);
```

### C# example

```csharp
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

public class WorkHubClient
{
    private readonly HttpClient _http;
    private readonly string _username;
    private readonly string _password;
    private readonly string _endpoint;

    public WorkHubClient(string username, string password, string? endpoint = null, HttpClient? http = null)
    {
        _username = username;
        _password = password;
        _endpoint = endpoint ?? "https://api.workhubplatform.io/v1/bulk-send";
        _http = http ?? new HttpClient();
    }

    public async Task<JsonElement> SendEmailAsync(object mail)
    {
        var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{_username}:{_password}"));

        using var request = new HttpRequestMessage(HttpMethod.Post, _endpoint)
        {
            Content = new StringContent(JsonSerializer.Serialize(mail), Encoding.UTF8, "application/json"),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);

        using var response = await _http.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();
        var data = JsonSerializer.Deserialize<JsonElement>(string.IsNullOrEmpty(body) ? "{}" : body);

        if (!response.IsSuccessStatusCode)
        {
            var code = data.TryGetProperty("error", out var e) ? e.GetString() : $"http_{(int)response.StatusCode}";
            var detail = data.TryGetProperty("message", out var m) ? m.GetString() : "";
            throw new Exception($"WorkHub BulkSender error [{code}]: {detail}");
        }

        return data; // { ok, sentAt, bulkSendEventId, ... }
    }
}

// Usage
var client = new WorkHubClient(
    Environment.GetEnvironmentVariable("WORKHUB_USERNAME")!,
    Environment.GetEnvironmentVariable("WORKHUB_PASSWORD")!);

var attachmentBytes = await File.ReadAllBytesAsync("contract.pdf");

await client.SendEmailAsync(new
{
    to = new[] { "recipient@example.com" },
    subject = "Please review and sign",
    htmlBody = "<p>Hello — please sign the attached document.</p>",
    attachments = new[]
    {
        new
        {
            fileName = "contract.pdf",
            contentBase64 = Convert.ToBase64String(attachmentBytes),
            mimeType = "application/pdf",
        },
    },
});
```

---

## 3. Inbound — Inbox API (`/v1/email/...`)

Used to poll a shared mailbox for incoming PDFs (email-to-sign). All requests
share the same auth headers (`x-api-key` preferred, HTTP Basic fallback) and
all responses are JSON. **API-key callers must always pass `mailboxId`** as a
query parameter — resolve it once via `GET /email/mailboxes` (matching on
`primaryEmail`) and reuse the UUID.

| Method | Path | Purpose |
|---|---|---|
| GET | `/email/mailboxes` | List mailboxes the credential/key can access |
| GET | `/email/inbox?mailboxId=&isRead=&hasAttachments=&maxResults=` | List messages |
| GET | `/email/inbox/{id}/attachments?mailboxId=` | List attachment metadata for a message |
| GET | `/email/inbox/{id}/attachments/{attachmentId}?mailboxId=` | Download one attachment (base64) |
| POST | `/email/inbox/{id}/mark-read?mailboxId=` | Mark a message read |

### Response shapes

WorkHub's response field names have varied across environments, so this app's
client tolerates common aliases (`items`/`messages`/`value`/`data` for list
envelopes; `id`/`emailId`/`messageId` for IDs, etc.). The examples below show
the primary shape observed in production.

`GET /email/mailboxes`:
```json
{ "items": [{ "id": "475fb43d-...", "primaryEmail": "inbox@yourcompany.com", "status": "active" }] }
```

`GET /email/inbox?mailboxId=...`:
```json
{
  "items": [
    {
      "id": "AAMkAGI...",
      "from": { "address": "sender@company.com" },
      "to": [{ "address": "inbox@yourcompany.com" }],
      "subject": "Please sign",
      "isRead": false,
      "hasAttachments": true
    }
  ]
}
```

`GET /email/inbox/{id}/attachments?mailboxId=...`:
```json
{ "items": [{ "id": "att-1", "name": "contract.pdf", "contentType": "application/pdf", "isInline": false }] }
```

`GET /email/inbox/{id}/attachments/{attachmentId}?mailboxId=...`:
```json
{ "contentBase64": "JVBERi0xLjQK..." }
```

### Important quirk — Java-serialized attachment bytes

Some mailboxes (Exchange, proxied through WorkHub's Java backend) return
attachment bytes as a base64-encoded **Java-serialized `byte[]`** instead of
the raw file. The stream starts with the magic bytes `0xACED0005` and wraps
the real content after a class-descriptor header. If you see corrupted PDFs
(e.g. missing the `%PDF` header), detect and strip this wrapper — see
[`unwrapSerializedAttachment`](../packages/lib/server-only/inbox/workhub-inbox-client.ts)
for the reference implementation: find the `0x78 0x70` (`TC_ENDBLOCKDATA` +
`TC_NULL`) terminator, read the following 4-byte big-endian length, and slice
out that many bytes as the real payload.

### Node.js example

```js
const API_BASE = 'https://api.workhubplatform.io/v1';

function authHeaders({ apiKey, username, password }) {
  if (apiKey) return { 'x-api-key': apiKey, 'content-type': 'application/json' };
  const basic = Buffer.from(`${username}:${password}`).toString('base64');
  return { authorization: `Basic ${basic}`, 'content-type': 'application/json' };
}

async function workhubRequest(config, method, path) {
  const res = await fetch(`${API_BASE}${path}`, { method, headers: authHeaders(config) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WorkHub inbox ${method} ${path} failed: ${body.error ?? res.status}`);
  return body;
}

function unwrapSerializedAttachment(buf) {
  if (buf.length < 6 || buf[0] !== 0xac || buf[1] !== 0xed || buf[2] !== 0x00 || buf[3] !== 0x05) {
    return buf; // not a serialized stream — raw bytes
  }
  for (let i = 0; i + 1 < buf.length; i++) {
    if (buf[i] === 0x78 && buf[i + 1] === 0x70) {
      const len = buf.readUInt32BE(i + 2);
      return buf.subarray(i + 6, i + 6 + len);
    }
  }
  return buf;
}

async function resolveMailboxId(config, email) {
  const { items = [] } = await workhubRequest(config, 'GET', '/email/mailboxes');
  return items.find((m) => m.primaryEmail?.toLowerCase() === email.toLowerCase())?.id ?? null;
}

async function pollInbox(config) {
  const mailboxId = await resolveMailboxId(config, config.inboxEmail);
  const { items: messages = [] } = await workhubRequest(
    config,
    'GET',
    `/email/inbox?mailboxId=${mailboxId}&isRead=false&hasAttachments=true&maxResults=50`,
  );

  for (const msg of messages) {
    const { items: attachments = [] } = await workhubRequest(
      config,
      'GET',
      `/email/inbox/${msg.id}/attachments?mailboxId=${mailboxId}`,
    );

    const pdf = attachments.find((a) => a.contentType === 'application/pdf');
    if (!pdf) continue;

    const { contentBase64 } = await workhubRequest(
      config,
      'GET',
      `/email/inbox/${msg.id}/attachments/${pdf.id}?mailboxId=${mailboxId}`,
    );

    const fileBytes = unwrapSerializedAttachment(Buffer.from(contentBase64, 'base64'));
    require('fs').writeFileSync(pdf.name, fileBytes);

    await workhubRequest(config, 'POST', `/email/inbox/${msg.id}/mark-read?mailboxId=${mailboxId}`);
  }
}

await pollInbox({
  apiKey: process.env.WORKHUB_API_KEY,
  inboxEmail: 'inbox@yourcompany.com',
});
```

### PHP example

```php
<?php

class WorkHubInboxClient
{
    private const API_BASE = 'https://api.workhubplatform.io/v1';

    public function __construct(
        private readonly ?string $apiKey = null,
        private readonly ?string $username = null,
        private readonly ?string $password = null,
    ) {}

    private function headers(): array
    {
        if ($this->apiKey) {
            return ["x-api-key: {$this->apiKey}", 'content-type: application/json'];
        }
        $basic = base64_encode("{$this->username}:{$this->password}");
        return ["authorization: Basic $basic", 'content-type: application/json'];
    }

    private function request(string $method, string $path): array
    {
        $ch = curl_init(self::API_BASE . $path);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $this->headers(),
        ]);
        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        $data = json_decode($body, true) ?? [];
        if ($status < 200 || $status > 299) {
            throw new RuntimeException("WorkHub inbox $method $path failed: " . ($data['error'] ?? $status));
        }
        return $data;
    }

    public function resolveMailboxId(string $email): ?string
    {
        $data = $this->request('GET', '/email/mailboxes');
        foreach ($data['items'] ?? [] as $mailbox) {
            if (strcasecmp($mailbox['primaryEmail'] ?? '', $email) === 0) {
                return $mailbox['id'];
            }
        }
        return null;
    }

    public static function unwrapSerializedAttachment(string $bytes): string
    {
        if (strlen($bytes) < 6 || substr($bytes, 0, 4) !== "\xac\xed\x00\x05") {
            return $bytes; // raw bytes, not a serialized stream
        }
        $term = strpos($bytes, "\x78\x70");
        if ($term === false || $term + 6 > strlen($bytes)) {
            return $bytes;
        }
        $len = unpack('N', substr($bytes, $term + 2, 4))[1];
        return substr($bytes, $term + 6, $len);
    }

    public function pollInbox(string $inboxEmail): void
    {
        $mailboxId = $this->resolveMailboxId($inboxEmail);

        $inbox = $this->request(
            'GET',
            "/email/inbox?mailboxId=$mailboxId&isRead=false&hasAttachments=true&maxResults=50",
        );

        foreach ($inbox['items'] ?? [] as $msg) {
            $attachments = $this->request(
                'GET',
                "/email/inbox/{$msg['id']}/attachments?mailboxId=$mailboxId",
            );

            $pdf = null;
            foreach ($attachments['items'] ?? [] as $att) {
                if (($att['contentType'] ?? '') === 'application/pdf') {
                    $pdf = $att;
                    break;
                }
            }
            if (!$pdf) continue;

            $file = $this->request(
                'GET',
                "/email/inbox/{$msg['id']}/attachments/{$pdf['id']}?mailboxId=$mailboxId",
            );

            $bytes = self::unwrapSerializedAttachment(base64_decode($file['contentBase64']));
            file_put_contents($pdf['name'], $bytes);

            $this->request('POST', "/email/inbox/{$msg['id']}/mark-read?mailboxId=$mailboxId");
        }
    }
}

$client = new WorkHubInboxClient(apiKey: getenv('WORKHUB_API_KEY'));
$client->pollInbox('inbox@yourcompany.com');
```

### C# example

```csharp
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

public class WorkHubInboxClient
{
    private const string ApiBase = "https://api.workhubplatform.io/v1";
    private readonly HttpClient _http;
    private readonly string? _apiKey;
    private readonly string? _username;
    private readonly string? _password;

    public WorkHubInboxClient(string? apiKey = null, string? username = null, string? password = null, HttpClient? http = null)
    {
        _apiKey = apiKey;
        _username = username;
        _password = password;
        _http = http ?? new HttpClient();
    }

    private async Task<JsonElement> RequestAsync(HttpMethod method, string path)
    {
        using var request = new HttpRequestMessage(method, $"{ApiBase}{path}");
        if (_apiKey is not null)
        {
            request.Headers.Add("x-api-key", _apiKey);
        }
        else
        {
            var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{_username}:{_password}"));
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);
        }

        using var response = await _http.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();
        var data = JsonSerializer.Deserialize<JsonElement>(string.IsNullOrEmpty(body) ? "{}" : body);

        if (!response.IsSuccessStatusCode)
        {
            var code = data.TryGetProperty("error", out var e) ? e.GetString() : response.StatusCode.ToString();
            throw new Exception($"WorkHub inbox {method} {path} failed: {code}");
        }
        return data;
    }

    public async Task<string?> ResolveMailboxIdAsync(string email)
    {
        var data = await RequestAsync(HttpMethod.Get, "/email/mailboxes");
        foreach (var mailbox in data.GetProperty("items").EnumerateArray())
        {
            if (string.Equals(mailbox.GetProperty("primaryEmail").GetString(), email, StringComparison.OrdinalIgnoreCase))
            {
                return mailbox.GetProperty("id").GetString();
            }
        }
        return null;
    }

    public static byte[] UnwrapSerializedAttachment(byte[] bytes)
    {
        if (bytes.Length < 6 || bytes[0] != 0xac || bytes[1] != 0xed || bytes[2] != 0x00 || bytes[3] != 0x05)
        {
            return bytes; // raw bytes, not a serialized stream
        }
        for (var i = 0; i + 1 < bytes.Length; i++)
        {
            if (bytes[i] == 0x78 && bytes[i + 1] == 0x70)
            {
                var len = (bytes[i + 2] << 24) | (bytes[i + 3] << 16) | (bytes[i + 4] << 8) | bytes[i + 5];
                return bytes[(i + 6)..(i + 6 + len)];
            }
        }
        return bytes;
    }

    public async Task PollInboxAsync(string inboxEmail)
    {
        var mailboxId = await ResolveMailboxIdAsync(inboxEmail);

        var inbox = await RequestAsync(
            HttpMethod.Get,
            $"/email/inbox?mailboxId={mailboxId}&isRead=false&hasAttachments=true&maxResults=50");

        foreach (var msg in inbox.GetProperty("items").EnumerateArray())
        {
            var msgId = msg.GetProperty("id").GetString();
            var attachments = await RequestAsync(
                HttpMethod.Get, $"/email/inbox/{msgId}/attachments?mailboxId={mailboxId}");

            JsonElement? pdf = null;
            foreach (var att in attachments.GetProperty("items").EnumerateArray())
            {
                if (att.GetProperty("contentType").GetString() == "application/pdf")
                {
                    pdf = att;
                    break;
                }
            }
            if (pdf is null) continue;

            var attId = pdf.Value.GetProperty("id").GetString();
            var file = await RequestAsync(
                HttpMethod.Get, $"/email/inbox/{msgId}/attachments/{attId}?mailboxId={mailboxId}");

            var bytes = UnwrapSerializedAttachment(Convert.FromBase64String(file.GetProperty("contentBase64").GetString()!));
            await File.WriteAllBytesAsync(pdf.Value.GetProperty("name").GetString()!, bytes);

            await RequestAsync(HttpMethod.Post, $"/email/inbox/{msgId}/mark-read?mailboxId={mailboxId}");
        }
    }
}

// Usage
var client = new WorkHubInboxClient(apiKey: Environment.GetEnvironmentVariable("WORKHUB_API_KEY"));
await client.PollInboxAsync("inbox@yourcompany.com");
```

---

## 4. Error handling checklist

- **Non-JSON responses**: gateways/proxies or auth redirects can return an HTML
  or plain-text page (e.g. a login page) instead of JSON on failure. Check the
  `Content-Type` header / sniff for `{`/`[` before parsing, rather than
  assuming the body is always valid JSON.
- **`429` / throttling**: read the `Retry-After` header and back off — the
  BulkSender endpoint enforces a monthly send limit (`monthlyUsed` /
  `monthlySendLimit` in the success payload let you track headroom
  proactively).
- **`409 mailbox_profile_missing`**: the mailbox exists (`GET
  /email/mailboxes` returns it) but has no backing mail connection
  provisioned on WorkHub's side (`proxy_profile_id` is null). This is a
  WorkHub-side provisioning gap, not a client bug — see
  [`WORKHUB_MAILBOX_PROFILE_ISSUE.md`](../WORKHUB_MAILBOX_PROFILE_ISSUE.md) for
  the full report and reproduction steps.
- **`409 sender_required`**: API-key callers must always pass `mailboxId`
  explicitly — there's no implicit "caller's own mailbox" for key auth (unlike
  Basic auth, which is bound to one mailbox per credential).
- **Idempotency**: this app dedupes inbound messages by mailbox message `id`
  before importing, and only calls `mark-read` after a message has been
  successfully processed — replay-safe if a poll run is interrupted.
