# HubSign — User Manual

**Organization administration, e-signature, and downstream integration**

Version 2.3.0 · Last updated 2026-08-09

---

## Contents

1. [What HubSign is](#1-what-hubsign-is)
2. [Roles and access](#2-roles-and-access)
3. [Part I — E-Signature](#part-i--e-signature)
   - [3.1 The signing lifecycle](#31-the-signing-lifecycle)
   - [3.2 Preparing a document](#32-preparing-a-document)
   - [3.3 Recipients, roles and signing order](#33-recipients-roles-and-signing-order)
   - [3.4 What the signer sees](#34-what-the-signer-sees)
   - [3.5 Supporting documents](#35-supporting-documents)
   - [3.6 Completion, the audit certificate, and downloads](#36-completion-the-audit-certificate-and-downloads)
   - [3.7 Rejecting, resending, cancelling](#37-rejecting-resending-cancelling)
   - [3.8 Templates and document merging](#38-templates-and-document-merging)
4. [Part II — Organization](#part-ii--organization)
   - [4.1 Dashboard](#41-dashboard)
   - [4.2 Settings](#42-settings)
   - [4.3 Members, domains and seats](#43-members-domains-and-seats)
   - [4.4 Signature Inbox (email-to-sign + OCR)](#44-signature-inbox-email-to-sign--ocr)
     - [4.4.2 Responsibility — who owes a signature](#442-responsibility--who-owes-a-signature)
     - [4.4.3 Exporting to Excel](#443-exporting-to-excel)
   - [4.5 Business Rules](#45-business-rules)
   - [4.6 Approvals](#46-approvals)
   - [4.7 Workflows](#47-workflows)
   - [4.8 Email Templates](#48-email-templates)
   - [4.9 Stamps, Metadata, Doc Manager](#49-stamps-metadata-doc-manager)
   - [4.10 Integrations (Microsoft Teams)](#410-integrations-microsoft-teams)
   - [4.11 Billing and Recycle Bin](#411-billing-and-recycle-bin)
5. [Part III — Integrating with ERP and accounting systems](#part-iii--integrating-with-erp-and-accounting-systems)
6. [Appendix A — Event reference](#appendix-a--event-reference)
7. [Appendix B — Known gaps](#appendix-b--known-gaps)

---

## 1. What HubSign is

HubSign is an electronic signature platform delivered as a cloud service on
**WorkHub Cloud**. A document is uploaded or received by email, fields are placed
on it, recipients sign it in the browser, and the result is a sealed,
cryptographically signed PDF with an audit trail.

Around that core it adds an organization layer: invoice intake by email with OCR
extraction, approval chains, a business rule engine that can refuse a signature,
a workflow engine, and a document management module.

There is nothing for you to install or run. Your organization is provisioned as a
tenant, and two consoles are involved:

| | Where | What it is for |
|---|---|---|
| **HubSign** | your HubSign address | Everything in this manual — documents, signing, organization settings |
| **WorkHub console** | `console.workhubplatform.io` | Tenant-level provisioning: subscription and seats, mailboxes for email intake, domains, users and SSO |

Most of the time you only need HubSign. The WorkHub console appears in this manual
where a task depends on tenant provisioning — buying seats, or creating the
mailbox the Signature Inbox reads from.

Three ideas are worth understanding before anything else, because most of the
platform's behaviour follows from them:

**Sealing is one-way.** When the last recipient signs, the PDF is flattened,
the audit certificate is appended, and the file is digitally signed. Everything
that affects the finished document — stamps, the certificate, field placement —
is decided at that moment and cannot be changed afterwards.

**The organization is the tenant.** Documents, rules, workflows and members
belong to an organization. Most settings you will want are under
**Organization**, not under personal Settings.

**HubSign reaches out from the cloud, not from your office.** Anything HubSign
calls — an ERP endpoint, a Teams webhook — is called from WorkHub Cloud. A system
that is only reachable inside your own network cannot be reached this way. This
matters for integrations; see [5.6](#56-before-you-go-live).

---

## 2. Roles and access

| Role | Scope | Can do |
|---|---|---|
| **Org Admin** | Organization | Everything below, plus settings, members, billing, rules, workflows, approvals, integrations |
| **Org Manager** | Organization | Day-to-day document work; some integration settings |
| **Org Member** | Organization | Create, send and sign documents; sees only their own work |
| **Platform operator** | WorkHub Cloud | Tenant provisioning and support actions. Held by your service provider, not by your organization |

Administrative screens are withheld from ordinary members in two places: the
sidebar hides the link, **and** the route itself refuses to render. Hiding a nav
item alone would leave the URL reachable by typing it.

```mermaid
flowchart TD
    A[Sign in] --> B{Organization member?}
    B -- No --> C[Personal account<br/>Documents + Templates only]
    B -- Yes --> D{Role}
    D -- Member --> E[E-Sign, Templates,<br/>Doc Merging, own documents]
    D -- Manager --> F[Member access +<br/>Inbox, Approvals, Doc Manager]
    D -- Org Admin --> G[Everything:<br/>Settings, Members, Rules,<br/>Workflows, Billing, Integrations]
```

---

# Part I — E-Signature

## 3.1 The signing lifecycle

Every document moves through the same five states.

```mermaid
stateDiagram-v2
    [*] --> DRAFT: Upload or received by email
    DRAFT --> PENDING: Send for signature
    PENDING --> PENDING: Each recipient signs
    PENDING --> COMPLETED: Last recipient signs → seal
    PENDING --> REJECTED: A recipient rejects → seal with stamp
    PENDING --> DRAFT: Cancel (before anyone signs)
    COMPLETED --> [*]
    REJECTED --> [*]
```

`COMPLETED` and `REJECTED` are terminal. Both produce a sealed PDF; a rejection
additionally stamps the reason onto the document.

## 3.2 Preparing a document

1. **E-Sign → Upload** — drop in a PDF.
2. **Add recipients** — name, email, and a role each (below).
3. **Place fields** — drag onto the page and assign each to a recipient.
4. **Settings** — subject, message, signing order, optional PDF password.
5. **Send** — recipients receive an email with a unique signing link.

### Field types

| Field | Signer does | Notes |
|---|---|---|
| **Signature** | Draws, types or uploads a signature | The legally operative mark |
| **Initials** | Draws initials | |
| **Name** | Confirms full name | Pre-filled from the recipient |
| **Email** | Confirms email | |
| **Date** | Auto-stamped at signing | |
| **Text** | Types free text | Can be required, with length limits |
| **Number** | Types a number | Min/max validation |
| **Checkbox** | Ticks one or more | Can require a minimum |
| **Radio** | Picks one option | |
| **Dropdown** | Selects from a list | |

Required fields block completion. A signer cannot finish until every required
field assigned to them is filled — the Complete button stays as "Next field"
and jumps them to what is outstanding.

## 3.3 Recipients, roles and signing order

| Role | Meaning |
|---|---|
| **Signer** | Fills fields and signs |
| **Approver** | Approves without signature fields |
| **Viewer** | Must open the document; adds no marks |
| **CC** | Receives the finished copy only |
| **Assistant** | Fills fields *on behalf of* another recipient, who then signs |

**Signing order** is either parallel (everyone at once) or **sequential** — each
recipient's link only becomes active when the previous one finishes. With
sequential order enabled you can also allow a signer to **dictate the next
signer**, entering their name and email at the moment they sign.

## 3.4 What the signer sees

The signer needs no account. They open the emailed link and get the document on
the left, and a signing panel on the right containing their full name, a
signature pad, an optional supporting-document uploader, and Complete.

```mermaid
sequenceDiagram
    participant S as Signer
    participant H as HubSign
    participant R as Business rules
    S->>H: Opens signing link
    H-->>S: Document + signing panel
    Note over H: DOCUMENT_OPENED recorded
    S->>H: Fills fields, draws signature
    S->>H: Clicks Complete → confirms
    H->>H: All required fields present?
    H->>R: Evaluate DOCUMENT_SIGN rules
    R-->>H: Allow / Block with message
    alt Blocked
        H-->>S: Reason shown in the dialog — nothing is signed
    else Allowed
        H->>H: Record signature
        H-->>S: Redirect to the completion page
        Note over H: Last signer? → seal the document
    end
```

If a business rule refuses the signature, the reason written by your
organization appears in the confirmation dialog and nothing is recorded.
Retrying without changing anything is refused identically.

## 3.5 Supporting documents

A signer can attach their own files above the signature — a purchase order, a
spec sheet, a photo.

- **Allowed:** PDF, Word, Excel, images, CSV
- **Blocked:** executables and archives, rejected by extension, MIME type **and**
  magic bytes, so renaming a file does not get it through
- **Limits:** 15 MB per file, 10 files per recipient
- **Storage:** the same object store as the document, linked to the signing request

Attachments upload immediately, so they survive an abandoned signing session.
They appear in the document's download section afterwards and are downloaded
one at a time.

## 3.6 Completion, the audit certificate, and downloads

When the last recipient signs, HubSign seals the document:

```mermaid
flowchart LR
    A[Last signature] --> B[Flatten form<br/>and annotations]
    B --> C[Render audit<br/>certificate]
    C --> D[Append certificate<br/>pages]
    D --> E[Insert signature<br/>fields into PDF]
    E --> F[Apply stamps]
    F --> G[Digitally sign PDF]
    G --> H[Optional password lock]
    H --> I[COMPLETED<br/>+ emails, webhooks, Teams cards]
```

### The audit certificate

The **Final Audit Report** is appended as extra page(s) recording who signed,
when, from where, and the document's integrity hash. It is your evidence that
the signature happened.

**It is added at seal time and cannot be added or removed afterwards.**

### Choosing whether to include it

**Organization → Settings → Signed Documents** controls whether new documents
get the certificate. This is the right switch if your documents are circulated
externally and the extra page is unwanted. It applies to documents completed
from that point on.

For documents already signed, use the **Download** split-button on the document
page:

- **Download** — the full signed record, certificate included
- **Download without audit certificate** — the signed pages only, for internal use

The same choice appears in the ⋯ menu and the documents-table row menu, along
with print equivalents.

> **Why both?** The certificate is baked into the sealed PDF, so a setting cannot
> retroactively strip it. The download option removes the trailing certificate
> pages from the copy you receive; the sealed original is untouched.

Documents that were password-locked at seal time cannot offer the strip option —
the file cannot be opened to count its pages, so they show a plain Download
button.

## 3.7 Rejecting, resending, cancelling

- **Reject** — a recipient declines with a reason. The document is sealed with a
  rejection stamp and the reason recorded. Terminal.
- **Resend** — re-send the invitation email to recipients who have not signed.
- **Cancel** — withdraw a document that is out for signature.
- **Recycle Bin** — deleted documents are recoverable from
  **Organization → Recycle Bin** before permanent deletion.

## 3.8 Templates and document merging

**Sign Templates** — save a document's recipients and field layout as a reusable
template. Creating a document from a template pre-places every field. Templates
can be given direct links so an external party can start their own copy.

**Doc Merging** — combine several uploads into one document before sending, for
cases where a signature packet spans multiple source files.

---

# Part II — Organization

## 4.1 Dashboard

**Organization → Dashboard** reports live signing activity for the organization:
documents sent, completed, pending and rejected; completion rate; turnaround
time; volume over time; per-member and per-recipient breakdowns.

- **Date range** — preset ranges or a custom window. Buckets switch from daily to
  monthly automatically once the span passes about two months.
- **Auto-refresh** — optional polling interval, remembered per browser.
- **Branding** — charts use your organization's brand colour.

Every figure is computed from your own documents. Cards that compare periods use
matching windows, so a partial current month is compared against the same days of
the previous month rather than a full one.

## 4.2 Settings

**Organization → Settings** is organized into cards. Each saves independently.

| Card | Controls |
|---|---|
| **General** | Name, slug, domain, logo |
| **Branding** | Primary/accent colours, sidebar, buttons — applied across the app, emails and charts |
| **Signed Documents** | Whether the audit certificate is attached at seal time |
| **Sign Reminders** | Automatically email recipients who have not signed after *N* days, up to a maximum count |
| **Email-to-Sign** | The organization inbox address, its WorkHub mailbox credentials, inbound filters |
| **Single Sign-On** | Your own OIDC provider — Azure AD, Google Workspace, Okta, Auth0 |
| **Member domains** | Restrict membership to specific email domains |
| **Security** | Enforce a single concurrent session per user |
| **Confidentiality** | Default classification for new documents |

### Single Sign-On

Enter your provider's well-known URL, client ID and secret. Members then sign in
at `/signin?org=<your-slug>`. Enabling **Disable self-signup** alongside a domain
restriction means people from your domain cannot create their own accounts — they
are told the organization exists and to ask an administrator for access.

## 4.3 Members, domains and seats

**Organization → Members** lists members, their roles and their seat status.

**Domain discovery.** If you have set a member domain, users who register with an
email on that domain appear here with **pending** status. **Convert** turns a
pending user into a full member: they are moved into the organization, a licensed
seat is consumed, and their company association is updated. Seat availability is
enforced at conversion — if you are out of seats, conversion is refused rather
than silently over-allocating.

```mermaid
flowchart TD
    A[User registers with<br/>acme.com address] --> B{Domain restricted<br/>to acme.com?}
    B -- No --> C[Ordinary personal account]
    B -- Yes --> D{Self-signup disabled?}
    D -- Yes --> E[Blocked: 'Organization exists,<br/>ask your admin']
    D -- No --> F[Appears in Members<br/>as PENDING]
    F --> G[Admin clicks Convert]
    G --> H{Seat available?}
    H -- No --> I[Refused — buy seats]
    H -- Yes --> J[Full member,<br/>seat consumed]
```

## 4.4 Signature Inbox (email-to-sign + OCR)

This is the invoice intake pipeline. Documents emailed to your organization's
address are queued, read by OCR, reviewed by a person, and then sent for
signature.

**The mailbox comes from WorkHub.** The address vendors send to is an Exchange
Online mailbox provisioned in the WorkHub console under *Email → Mailboxes*, and it
consumes a mailbox licence there. HubSign reads that mailbox using the credentials
entered under **Organization → Settings → Email-to-Sign**. If intake stops working,
check the mailbox still exists and is licensed in WorkHub before looking at HubSign.

```mermaid
flowchart TD
    A[Vendor emails invoice<br/>to org inbox address] --> B[Inbound poll<br/>or webhook]
    B --> C{Should ingest?}
    C -- "Self-sent / blocked<br/>sender or subject" --> D[Discarded<br/>loop guard]
    C -- Yes --> E[One queue item<br/>per attachment]
    E --> F[Create draft document]
    F --> G[OCR / BMS ML extraction]
    G --> H[Status: READY<br/>fires INBOX_OCR_COMPLETED]
    H --> I[Reviewer checks<br/>extracted fields]
    I --> J{Approval required?}
    J -- Yes --> K[Approval chain]
    J -- No --> L[Send for signature]
    K -- Approved --> L
    K -- Rejected --> M[Status: REJECTED]
    L --> N[Normal signing flow]
    N --> O[Signed → inbox status<br/>updated to match]
```

**One document per attachment.** Five invoices in one email produce five queue
items, five OCR runs and five workflow firings. They are deliberately not merged
— separate attachments are usually separate invoices from separate vendors.

**The loop guard.** A completion notification arriving back in the inbox with the
signed PDF attached would create a new document, complete it, send another
notification, and repeat. Two rules always apply and cannot be switched off:
mail from the system's own send address is discarded, and mail addressed by the
organization to its own inbox address is discarded. On top of that you can
configure blocked senders and blocked subjects.

**Live updates.** The queue updates itself as documents arrive and OCR finishes,
using database notifications rather than polling the browser.

**Search.** The search box matches across *every* extracted value — vendor,
invoice number, PO number, amounts, line items, addresses, phone numbers — plus
the document title and sender. It is not limited to a fixed list of fields.

**Reviewing.** **Review** opens the extracted data beside the document. Correct
anything OCR misread, then send for signature. A confidence score and a
"needs review" flag are shown per item.

### 4.4.1 Extraction templates — the lever on OCR accuracy

BMS ML extracts far more accurately when it knows what kind of document it is
looking at. Given a matching **extraction template** it pulls named fields with
per-field confidence; given none it falls back to generic AI extraction, which
is materially less accurate and returns a different, less predictable set of
fields.

A template has to be chosen *before* the document is read, when the only
reliable thing known about it is who sent it. So the sender address is the
routing key. In order:

1. A template picked by hand on the item, if someone re-ran OCR with one chosen.
2. The template on the metadata vendor record whose **Email** matches the sender.
3. The template on a vendor record with the **same email domain** as the sender.
4. The organization's default template (Organization → Settings).
5. None — generic extraction.

Domain matching deliberately skips public providers (gmail.com, outlook.com and
similar). Without that, one vendor saved with a Gmail contact would capture every
document arriving from any Gmail account.

**Assigning a template.** Set **OCR template** on the vendor's metadata record,
or open an item, choose a template, and tick *"Always use this template for
&lt;sender&gt;"* when re-running OCR — which writes it back to that sender's
vendor record, creating one if none exists. Accuracy therefore improves with use
rather than requiring the directory to be filled in up front.

**Seeing which template ran.** Each item shows the template that was applied and
why it was chosen ("matched *vendor* by sender email"), or an amber **No
template** badge when extraction ran generically. If items are extracting poorly,
that badge is the first thing to check.

### 4.4.1a Correcting what OCR read

Every extracted field on the review screen can be corrected. Click the pencil
beside a value to change it, or **Correct or add a field** to supply one the
extractor never found at all — a PO number, most often.

This matters more than it sounds. Until now `extractedData` had exactly one
writer, the OCR job, so a misread value could not be fixed by anybody. A
business rule reading that value would refuse signing permanently with no way
out. In this deployment every extracted `po_number` is noise, so a rule
requiring one could never be satisfied from OCR alone.

A corrected value is marked with a person icon and the word **entered**, and it
loses its confidence percentage. That is deliberate: a figure somebody typed and
a figure the extractor read are different kinds of evidence, and showing "90%"
beside a hand-entered value would be an invention. Hovering shows who entered it
and when, and the change is recorded on the document's timeline with both the
old and new values.

Corrections are refused once a document is complete — it was signed against the
data as it stood, and rewriting that afterwards would falsify the record.

### 4.4.1b The signer supplies a missing PO number

A rule that requires a PO number is usually enforced against an external signer
— somebody who has a signing link and nothing else. They cannot open the
Signature Inbox, so the block has to be clearable from the signing page itself.

**Attaching the purchase order.** Under **Supporting documents** on the signing
page, the signer attaches the PO. If it is a PDF or an image, HubSign reads it
immediately and tells them what it found: *"PO number MER-PO-5023 read from this
file"*. Pressing **Sign** again re-evaluates the rules against the new
information, and the signature goes through.

Nothing needs to happen in your office for this to work — that is the point.
The read is bounded rather than open: only PDFs and images are sent, only after
the upload's magic-byte validation has passed, and only when your organization
has an extraction service configured.

The signer's attachments now also survive a page refresh, so they can see and
remove what they have already sent instead of attaching the same file twice.

**Typing it instead.** If the sender placed a text field labelled "PO Number" on
the document, whatever the signer types into it is visible to rules as
`fields.po_number`. Any document field works this way — the label becomes the
path, lowercased with underscores — and a numeric field also gets a
`fields.<name>_number` form so threshold comparisons behave.

**Reading it from your side.** An org member can still read any attachment by
hand: it appears under **Attachments from the signer** on the review screen with
a **Read with OCR** button.

Once read, the attachment's own fields become available to business rules under
`attachedPo.*` — `attachedPo.po_number`, `attachedPo.vendor_name`,
`attachedPo.total_amount`, plus `attachedPo.applicable`, which tells a rule
whether anything was read at all. The **Attached PO must match the invoice**
preset uses them to block signing when the two PO numbers disagree, and it
deliberately stays silent when either number is missing — silence is not
disagreement.

Two honest limits. The extraction service is an invoice extractor: it has never
returned a `purchase_order` classification in this deployment, so do not gate on
`attachedPo.documentType` without checking what it actually returns for your
documents. And this compares header fields only — line-item matching, the third
leg of a true three-way match, is not built, and there is no goods-receipt
concept in HubSign at all.

### 4.4.2 Responsibility — who owes a signature

The **Responsibility** column answers the question the queue is usually opened
to answer: who is this waiting on, and how often have we asked them.

- For a document signed **in order**, it names only the person whose turn it is,
  with their step number ("step 2 of 3"). The three people behind them in the
  chain have not been asked yet, so naming them would be misleading.
- For a document signed **all at once**, it names everyone still outstanding.
- **"not emailed yet"** distinguishes a recipient who has not been contacted
  from one who is ignoring us.
- A declined document shows who declined, and a finished one shows that everyone
  signed.

The blue **reminders** chip beside the name shows the total sent and how long
ago. Hovering it lists each send with its date, whether it was automatic or sent
by hand, and who sent it.

One honest caveat is shown in that hover card where it applies. Reminder times
were not recorded before this feature existed — the system kept a count and a
single "last reminded" timestamp per person, overwritten on each send. For
anyone reminded more than once before then, only the most recent date survives,
and the card says how many earlier sends have no recorded time rather than
quietly listing fewer dates than the count beside it. Everything sent from now
on is logged individually.

Automatic reminders are configured in Organization → Settings; manual ones come
from **Send reminder** on the document. A manual reminder deliberately does not
spend the automatic quota, so nudging someone by hand will not switch their
scheduled reminders off.

### 4.4.3 Exporting to Excel

**Export to Excel**, beside the search box, opens the column builder.

The left panel is every field available for this organization, grouped:
document and status fields, the invoice fields as the grid reads them, signing
and reminder state, SLA figures, workflow status, OCR quality, and every raw OCR
key the extractor has actually produced for your documents. That last group is
discovered from your own data rather than a fixed list, so a field a new
extraction template starts returning appears without any change to HubSign.

The right panel is the sheet as it will be written — drag rows to reorder
(top to bottom becomes left to right in Excel), click a heading to rename it,
and **Add custom** appends a fixed-value column, useful for a "Checked by"
column someone fills in after the fact.

**Reference tables.** **Attach** joins your Metadata directory onto every row,
so a vendor's phone number or account code can sit beside the invoice. Rows are
paired by vendor name using the same fuzzy matching the workflow engine uses, so
"Northgate Consulting Ltd." on the invoice finds "Northgate Consulting Limited"
in the directory. Two extra columns record how each pairing was made — the match
percentage and whether it was exact, a legal-form difference, or approximate —
so a match can be audited rather than trusted. Where two directory entries score
too closely to choose between, the row is left blank instead of guessed. You can
change which category is searched and raise the match threshold.

**Filters** at the top decide which rows go in. Opening the dialog from the
Signature Inbox carries the grid's current filters across.

Every workbook has a second sheet, **Export notes**, recording when it was
generated and by whom, the filters applied, how many rows matched, and how the
reference-table join performed. Exports are capped at 5,000 rows; if the filters
match more, the notes sheet says so rather than letting a truncated file pass for
a complete one.

The export is generated on the server from the full filtered set — it is not a
copy of the rows on screen, which are capped at 100.

**Saving a layout.** Name it and press **Save layout**, and it appears under
Organization → **Exports**, where it can be re-run with one click or edited. The
Exports page is shared by every grid that supports exporting.

## 4.5 Business Rules

**Organization → Business Rules** lets you refuse or flag an action based on the
document's own data. This is where "an invoice with no PO number cannot be
signed" lives.

A rule has four parts:

| Part | Meaning |
|---|---|
| **When** (gate) | The moment it is checked — before sending, before a recipient signs, before an inbox item is marked ready |
| **Condition** | JSONLogic describing **the problem**. True means the rule fires |
| **Then** (outcome) | **Block** the action, or **Warn** only |
| **Message** | Shown to the user when it fires — so write the fix, not the complaint |

> **Conditions describe the violation, not the requirement.** "PO is missing", not
> "PO is required".

### Available data

Rules read from a fact registry, grouped by namespace. The builder lists every
field available, generated from the registry itself:

| Namespace | Examples |
|---|---|
| `document` | title, status, page count, age |
| `recipients` | count, how many have signed, roles |
| `organization` | name, member count, settings |
| `actor` | who is performing the action |
| `attachments` | supporting file count |
| `ocr` | every extracted invoice field, plus confidence and reliability signals |

### Writing rules against OCR data

OCR output is a machine's guess, and the builder says so on screen. Two habits
matter:

**Use `ocr.has_plausible_po`, not `ocr.po_number`.** A presence check accepts a
misread — real extractions in this tenant include `po_number` values of
`"Box"`, `"licy"` and `"rt"`, all of which "are present". The derived fact
requires at least four characters including a digit.

**Pair presence checks with `ocr.confidence`** when the consequence is a hard
block.

### Examples

Invoice with no usable PO number:

```json
{ "!": [{ "var": "ocr.has_plausible_po" }] }
```

Over 300,000 with no usable PO:

```json
{ "and": [
  { ">": [{ "var": "ocr.total_amount" }, 300000] },
  { "!": [{ "var": "ocr.has_plausible_po" }] }
]}
```

No supporting paperwork attached:

```json
{ "==": [{ "var": "attachments.count" }, 0] }
```

### Testing before you enforce

**Test against a document** evaluates every rule at a gate against a real
document and shows both the verdict and the data the rules saw — without
enforcing anything and without signing. Use it, then switch the rule from Warn
to Block.

```mermaid
flowchart LR
    A[Write rule<br/>as Warn] --> B[Test against<br/>real documents]
    B --> C{Fires where<br/>you expect?}
    C -- No --> D[Inspect the data<br/>the rules saw]
    D --> A
    C -- Yes --> E[Edit → switch to Block]
    E --> F[Enforced at signing]
```

**Rule evaluation fails open.** If a rule's logic is malformed or the data cannot
be gathered, the action is allowed and the problem logged. A bug in one rule must
not stop every signature in the organization. Do not model a control that must
never be bypassed as a soft gate.

## 4.6 Approvals

**Approval Setup** defines approval templates; **Approvals** is the queue.

An approval chain gates a document before it goes out for signature — typically
an emailed invoice that needs internal sign-off first. Templates support
sequential and parallel stages, five ways of resolving who approves (named user,
role, manager, dynamic field, or group), JSONLogic conditions on whether a stage
applies at all, validation rules, reminders, and chaining one template into
another.

```mermaid
flowchart TD
    A[Inbox document READY] --> B{Approval template<br/>matches?}
    B -- No --> C[Straight to<br/>send for signature]
    B -- Yes --> D[Stage 1 approvers notified]
    D --> E{Decision}
    E -- Rejected --> F[Document rejected,<br/>requester notified]
    E -- Approved --> G{More stages?}
    G -- Yes --> H[Next stage]
    H --> E
    G -- No --> I[Approved → release<br/>for signature]
```

## 4.7 Workflows

**Organization → Workflows** is a general automation engine: a trigger, an
optional condition, and a graph of steps.

**Triggers**

- **Event** — a system event (see [Appendix A](#appendix-a--event-reference))
- **Schedule** — a cron expression in your timezone
- **Manual** — run on demand

**Step types**

| Step | Purpose |
|---|---|
| `CONDITION` | Continue only if a JSONLogic rule passes |
| `BRANCH` | Fork the path |
| `SET_VARIABLE` | Compute a value into the run context |
| `ACTION` | Do something (below) |

**Actions**

| Action | Does |
|---|---|
| `SEND_EMAIL` | Sends an email, optionally rendering a saved Email Template by key |
| `HTTP_REQUEST` | Calls an external URL — the integration workhorse |
| `NOTIFY` | Raises an in-app notification |
| `SEND_FOR_SIGNATURE` | Sends a document for signature, optionally adding recipients |
| `LOOKUP_METADATA` | Matches against your metadata records to enrich the run |

Any string in a step config supports `{{ path.to.value }}` templating against the
run context — the trigger payload, the document, the organization, and variables
you have set.

**Runs** are recorded per workflow with per-step status, so a failure shows which
step failed and why.

## 4.8 Email Templates

**Organization → Email Templates** stores reusable subject/HTML/text bodies,
each with a **key**. A workflow's `SEND_EMAIL` step references the key instead of
carrying markup inline, so the same wording is edited in one place.

Templates render `{{ }}` placeholders against the workflow run context.

> If a step references a key that does not exist, the step is **skipped** rather
> than sending a blank email.

## 4.9 Stamps, Metadata, Doc Manager

**Stamps** — image or text stamps (a company seal, "PAID", a registration mark)
positioned on a document and burned in at seal time.

**Metadata** — the organization's lookup directory, resolved by
`LOOKUP_METADATA` at workflow run time. One record per vendor holds everything
the invoice flow needs about them:

| Field | Used for |
| --- | --- |
| **Name** | The lookup key. Matched against the vendor name read off the invoice. |
| **Email** | Where the "we received your invoice" confirmation is sent. |
| **Signers** | The approval chain — who the document is sent to, and in what order. |
| **OCR template** | The BMS ML template invoices from this vendor extract with (see §4.4.1). |
| **Keywords** | Alternative matching, by scanning the OCR text rather than the name. |

Records are maintained on the page, or in bulk via **Download template** → edit
in Excel → **Import CSV**. Re-importing an edited file updates matching records
rather than duplicating them.

### 4.9.1 Invoice received → confirm to vendor → send for signature

Both automations are one `INBOX_OCR_COMPLETED` workflow over a single lookup:

```
lookup            LOOKUP_METADATA  category "vendor", key {{payload.vendorName}}
 └ check          CONDITION        vars.vendor.found == true
    └ email       SEND_EMAIL       to {{vars.vendor.email}}, templateKey "invoice-received"
       └ check_signer   CONDITION  !! vars.vendor.signerEmail
          └ send_for_signature  SEND_FOR_SIGNATURE  recipientsFrom {{vars.vendor.signers}}
```

A vendor with no signer set still gets the confirmation — the run simply stops
at `check_signer`. That is the intended way to say "acknowledge this vendor's
invoices but don't route them for signature".

**Use the canonical field names, not `extractedData`.** Every OCR template names
its fields differently — one emits `vendor_name`, another `merchant_name`, a
third `supplier`. HubSign publishes template-independent values on the event
payload; read those and a document routed to a different template keeps working.

| What you want | Path |
| --- | --- |
| Vendor name | `{{payload.vendorName}}` |
| Invoice number, total, dates | `{{payload.invoiceNumber}}`, `{{payload.totalAmount}}`, `{{payload.invoiceDate}}`, `{{payload.dueDate}}` |
| The document to send | `{{payload.document.id}}` |
| Who emailed the invoice | `{{payload.sender}}` |
| A looked-up record | `{{vars.<saveAs>.email}}`, `{{vars.<saveAs>.signers}}`, `{{vars.<saveAs>.signerEmail}}`, … |
| The organization | `{{organization.name}}` |
| Raw OCR field (discouraged) | `{{payload.extractedData.<field>}}` |

The full list of canonical names, and the extractor-side naming rules that keep
them working, is in
[BMS ML field contract](./BMS_ML_FIELD_CONTRACT.md). There is no `ocr.*` root.

> **The silent-failure mode to know.** A `key` that resolves to an empty string
> makes the lookup return `found: false`, the `CONDITION` takes its else-branch,
> and the run finishes as **COMPLETED** having done nothing. No error is raised
> anywhere. This ran unnoticed for 21 runs on one deployment — the workflow read
> `payload.extractedData.vendor_name` while the template emitted `merchant_name`.
> When a workflow "succeeds" but nothing happened, open the run and check the
> `lookup` step's output: an empty `"key": ""` means the path is wrong, not that
> the vendor is missing.

**Name matching is forgiving.** The name on an invoice is whatever OCR read off
the page, and it rarely matches your directory character for character.
`LOOKUP_METADATA` in name mode therefore tries three passes and stops at the
first that answers:

| Pass | What it ignores | Score | Example |
|------|-----------------|-------|---------|
| Exact | case, punctuation, accents, `&` vs `and` | 100% | `Northgate Consulting Ltd.` → `Northgate Consulting Ltd` |
| Legal form | the company suffix, and leading "The" | 97% | `NORTHGATE CONSULTING LIMITED` → `Northgate Consulting Ltd` |
| Fuzzy | a character or two of scanning noise | ≥ 85% | `Northgate Consultng Ltd` → `Northgate Consulting Ltd` |

So `Company Limited`, `Company Ltd.` and `Company` are all one vendor, and
`Digital Ocean` finds `DigitalOcean`.

The step's output carries `matchScore` (a percentage) and `matchMethod`
(`exact`, `core` or `fuzzy`), so a later condition can treat an uncertain match
differently — for instance, notify a human instead of emailing the vendor:

```json
{ ">=": [{ "var": "vars.vendor.matchScore" }, 97] }
```

Raise the bar for a particular step with `minScore` (50–100, default 85):

```json
{ "action": "LOOKUP_METADATA", "category": "vendor",
  "key": "{{payload.vendorName}}", "minScore": 92, "saveAs": "vendor" }
```

**What it deliberately will not match.** A fuzzy hit has to be unambiguous, because
the cost of a wrong one is a payment confirmation sent to the wrong company or an
invoice routed to the wrong approver. So the lookup returns *nothing* rather than
guess when:

- one whole word differs — `Southgate Consulting` will not match `Northgate
  Consulting`, even though only two characters separate them;
- a branch or unit number differs — `Depot 24` never matches `Depot 42`;
- two directory records fit almost equally well — the step logs both and reports
  `found: false` with `ambiguous: true`;
- the name is shorter than four characters once the suffix is removed.

A miss is visible in the run log as `no "vendor" match for "..." (closest 72%)`,
which tells you whether to add the vendor or lower `minScore`.

The same matching is used for per-vendor SLA targets and for grouping the SLA
dashboard's vendor table, so a vendor is one row there exactly when it is one
record here.

**Several signers, in order.** A vendor record holds a list, not one person, and the
order in the list is the order they are asked. Set it in the **Signers** table on
the Metadata page — add a row per person, pick a role, and move rows with the
arrows. Type into the address box to search your organization's members, or just
enter any address for someone who has no account here.

Point a `SEND_FOR_SIGNATURE` step at the whole list rather than at one address:

```json
{ "action": "SEND_FOR_SIGNATURE",
  "documentId": "{{payload.document.id}}",
  "recipientsFrom": "{{vars.vendor.signers}}" }
```

`recipientsFrom` exists because `recipients` is a fixed array in the workflow
JSON, and a `{{ }}` placeholder substitutes text — it cannot expand into "one
entry per signer this vendor happens to have".

With **In order** (the default for more than one signer) each person is only
invited once the one above has signed. **All at once** asks everyone
immediately. A step can override the record with `"signingOrder": "SEQUENTIAL"`
or `"PARALLEL"`.

In the spreadsheet this is a single **Signers** column, `email|role|name` with
`;` between people:

```
jane@x.com|SIGNER|Jane Doe;marcus@x.com|APPROVER|Marcus Reid;ap@x.com|CC|Finance
```

Only the address is required, so `jane@x.com;bob@x.com` is valid and both become
SIGNER. A role that isn't recognised is reported on that row and treated as
SIGNER rather than failing the import. The old `Signer name` / `Signer email` /
`Signer role` columns still import, as a chain of one.

**Recipient role can be templated.** `role` on a `SEND_FOR_SIGNATURE` recipient
accepts a literal (`SIGNER`, `APPROVER`, `CC`, `VIEWER`) *or* a placeholder such
as `{{vars.vendor.signerRole}}`, so the role travels with the vendor record
instead of being fixed in the step. An unrecognised value falls back to `SIGNER`
and logs a warning on the run rather than failing the send.

**Preconditions for the send to fire.** The document must still be `DRAFT` and
must belong to this organization's Signature Inbox; otherwise the step skips
with `already-<status>` or `document-not-in-org-inbox`. On success the inbox
item moves to `SENT_FOR_SIGNATURE`.

> Migrating from the older two-record setup (a separate `signee` record named
> after the vendor)? Move the signer's address into the vendor record's **Signer
> email** field, point the step at `{{vars.vendor.signerEmail}}`, and delete the
> `signee` record and its lookup step. Separate `signee` records still resolve,
> so nothing breaks until you do.

**Doc Manager (DMS)** — filing structure, classification, search and retrieval
requests over your document library, with **DMS Permissions** controlling who
sees what and a confidentiality classification per document. Filing and
retrieval both emit workflow events.

## 4.10 Integrations (Microsoft Teams)

**Organization → Integrations** connects one Microsoft Teams destination per
organization, by either transport:

- **Power Automate webhook** — paste an incoming webhook URL
- **Azure bot** — register the bot for richer, updatable cards

Add **channels**, each subscribing to all events or a chosen subset. Notifications
are sent as Adaptive Cards; with the bot transport a card can be updated in place
as a document progresses, rather than posting a new message per event.

Outbound URLs are validated against an allow-list before any request is made.

## 4.11 Billing and Recycle Bin

**Billing** — shows your subscription, seat count and period as provisioned for
your tenant. Seat availability is what gates member conversion: converting a
pending user consumes a seat, and conversion is refused when none are free.

Seats are purchased in the **WorkHub console** under *My Subscription*, not here.
This page reflects what your tenant has been allocated.

**Recycle Bin** — deleted **Doc Manager** records, restorable by an Org Admin or DMS
Admin. E-Sign documents do not appear here: a draft or pending document is deleted
outright and permanently, and a completed one is retained but not restorable from this
page. The interface mentions 30-day retention, but nothing currently purges expired
items automatically.

---

# Part III — Integrating with ERP and accounting systems

This is where signing stops being paperwork and starts being data. A signed
invoice, contract or authorization is an event your finance system should know
about, and HubSign already has the outbound mechanisms to tell it.

## 5.1 What is available today

Three integration surfaces exist and work now.

```mermaid
flowchart TD
    subgraph HubSign
        A[Document completed<br/>and sealed]
    end
    A --> B[Webhooks<br/>7 lifecycle events]
    A --> C[REST API<br/>v1 + v2 beta]
    A --> D[Workflow HTTP_REQUEST<br/>action]

    B --> E[Your middleware<br/>or iPaaS]
    C --> E
    D --> F[ERP endpoint<br/>direct]
    E --> G[(ERP / Accounting<br/>QuickBooks · Sage · SAP<br/>NetSuite · Dynamics · Xero)]
    F --> G
```

### 1. Webhooks — push, no polling

Configured per user or per team, subscribing to any of seven events:
`DOCUMENT_CREATED`, `DOCUMENT_SENT`, `DOCUMENT_OPENED`, `DOCUMENT_SIGNED`,
`DOCUMENT_COMPLETED`, `DOCUMENT_REJECTED`, `DOCUMENT_CANCELLED`.

`DOCUMENT_COMPLETED` fires after the document is sealed, so by the time your
endpoint is called the final PDF exists and is retrievable. This is the natural
trigger for posting to an ERP.

The payload carries the document, its recipients and their signing status.

### 2. REST API — pull and push

- **v1** (`/api/v1`) — documents, templates, recipients, fields, team members.
  Create a document, send it, download the signed file, inspect status.
- **v2 beta** — OpenAPI document published at the v2 beta URL for client generation.

Authentication is by **API token**, created per user or per team.

Endpoints that matter most for finance integration:

| Purpose | Endpoint |
|---|---|
| List documents | `GET /api/v1/documents` |
| Get one document | `GET /api/v1/documents/:id` |
| **Download the signed PDF** | `GET /api/v1/documents/:id/download` |
| Create from a template | `POST /api/v1/templates/:templateId/create-document` |
| Send for signature | `POST /api/v1/documents/:id/send` |

### 3. Workflow `HTTP_REQUEST` — integration without writing a service

The lowest-effort route. A workflow calls your ERP directly, with the payload
templated from the run context. No middleware to deploy.

Configuration: method, URL, headers, body, timeout (default 10s, max 30s), and
`saveResponseAs` to capture the ERP's response into a run variable — so a later
step can email the resulting voucher number, or store it.

## 5.2 Pattern A — Accounts payable invoice posting

The flow this platform was shaped around: an invoice arrives by email, is read,
approved, signed, and posted to the ledger.

```mermaid
sequenceDiagram
    participant V as Vendor
    participant H as HubSign
    participant O as OCR
    participant A as Approver
    participant E as ERP / Accounting

    V->>H: Emails invoice PDF
    H->>O: Extract fields
    O-->>H: Vendor, invoice #, PO #, amounts, dates
    H->>H: Business rules — PO present? over threshold?
    H->>A: Approval chain
    A-->>H: Approved
    H->>H: Send for signature → signed → sealed
    H->>E: POST /vendor-bills (workflow HTTP_REQUEST)
    E-->>H: Voucher / bill ID
    H->>H: Store ID, notify AP team
    E->>E: Payment run
```

The extracted OCR fields are exactly an AP posting payload: vendor, invoice
number, PO number, invoice date, due date, currency, subtotal, tax, total. A
workflow on `DOCUMENT_COMPLETED` can post them with no re-keying.

**Example workflow step**

```json
{
  "type": "ACTION",
  "config": {
    "action": "HTTP_REQUEST",
    "method": "POST",
    "url": "https://erp.example.com/api/ap/vendor-bills",
    "headers": {
      "Authorization": "Bearer {{ vars.erpToken }}",
      "Idempotency-Key": "hubsign-doc-{{ document.id }}"
    },
    "body": {
      "vendorName": "{{ payload.vendorName }}",
      "invoiceNumber": "{{ payload.invoiceNumber }}",
      "poNumber": "{{ payload.poNumber }}",
      "invoiceDate": "{{ payload.invoiceDate }}",
      "dueDate": "{{ payload.dueDate }}",
      "currency": "{{ payload.currency }}",
      "subtotal": "{{ payload.subtotal }}",
      "taxAmount": "{{ payload.taxAmount }}",
      "totalAmount": "{{ payload.totalAmount }}",
      "signedPdfUrl": "{{ document.downloadUrl }}",
      "signedAt": "{{ document.completedAt }}"
    },
    "saveResponseAs": "erpBill"
  }
}
```

> **Send the idempotency key.** Retries and re-runs happen. Keying on the HubSign
> document ID lets the ERP recognise a duplicate post instead of creating a second
> liability.

## 5.3 Pattern B — Three-way match

Business rules can enforce the match *before* anyone signs, so a mismatch never
reaches the ledger.

```mermaid
flowchart TD
    A[Invoice OCR'd] --> B[Workflow: HTTP_REQUEST<br/>GET PO from ERP]
    B --> C[saveResponseAs: po]
    C --> D{Business rule at<br/>DOCUMENT_SIGN}
    D -- "No PO, or<br/>amount over tolerance" --> E[BLOCK<br/>with the reason]
    D -- Matches --> F[Signing proceeds]
    F --> G[Post to ERP]
```

Fetch the PO and goods receipt from the ERP into run variables, compare against
the extracted invoice, and block on a discrepancy — with a message telling the
signer which figure disagrees.

## 5.4 Pattern C — Signed-document archival

Finance systems usually want the document itself attached to the transaction,
not just its numbers.

On `DOCUMENT_COMPLETED`, fetch `GET /api/v1/documents/:id/download` and attach
the PDF to the ERP record, the DMS, or both.

Two decisions to make deliberately:

**Which version to attach.** The full sealed PDF including the audit certificate
is the evidentiary copy and belongs in the archive. A copy without the
certificate is the one to circulate. Both are available — see
[3.6](#36-completion-the-audit-certificate-and-downloads).

**Where the system of record lives.** Attaching to the ERP and filing in the DMS
both make sense; deciding which one auditors will be pointed at does not happen
by itself.

## 5.5 Choosing an approach

| | Workflow `HTTP_REQUEST` | Webhook + middleware | REST API polling |
|---|---|---|---|
| **Effort** | Lowest — configuration only | Medium — a service to deploy | Medium |
| **Latency** | Immediate | Immediate | Poll interval |
| **Transform / map fields** | Templating only | Anything | Anything |
| **Retry, queue, dead-letter** | No | Yours to build | Yours to build |
| **Multiple destinations** | One step each | One consumer, fans out | — |
| **Best for** | One ERP, straightforward mapping | Several systems, real mapping logic, guaranteed delivery | Reconciliation, backfill |

**Recommendation.** Start with `HTTP_REQUEST` — it proves the mapping in an
afternoon. Move to webhook-plus-middleware when you need guaranteed delivery,
several destinations, or transformation beyond string templating.

## 5.6 Before you go live

**Delivery is not guaranteed by `HTTP_REQUEST`.** It has a timeout and it records
failure on the run, but it is not a durable queue — there is no automatic retry
with backoff and no dead-letter. If a posting must not be lost, put a queue
between HubSign and the ERP, and reconcile.

**Make every write idempotent.** Send the document ID as an idempotency key.

**Never send OCR figures straight to the ledger unreviewed.** Extraction is a
guess. The review step in the Signature Inbox exists for this reason, and
`ocr.confidence` exists so a rule can insist on it. A misread total posts a
wrong liability silently.

**Store credentials as workflow variables,** not inline in a step body that anyone
with workflow access can read.

**Your ERP endpoint has to be reachable from the internet.** HubSign runs in
WorkHub Cloud, so a workflow's `HTTP_REQUEST` and every webhook leave from there —
not from inside your network. An address like `https://erp.internal/...` will not
resolve. You have three options:

| Option | What it means |
|---|---|
| **Public HTTPS endpoint** | Expose a narrow, authenticated integration endpoint. Restrict it to WorkHub Cloud's egress addresses — ask your provider for the current list. |
| **Reverse tunnel or VPN** | Terminate a tunnel at a host that is publicly reachable and forward to the ERP. |
| **Pull instead of push** | Leave the ERP closed and have middleware inside your network poll the HubSign REST API for completed documents. Slower, but nothing inbound is opened. |

The pull option is worth considering seriously if opening anything to your finance
system is a problem. `GET /api/v1/documents` plus a stored watermark is enough.

**Reconcile.** Compare completed documents against posted transactions on a
schedule — a `SCHEDULE` workflow can do this and notify on drift.

---

## Appendix A — Event reference

### Webhook events — all fire today

| Event | When |
|---|---|
| `DOCUMENT_CREATED` | Document created |
| `DOCUMENT_SENT` | Sent for signature |
| `DOCUMENT_OPENED` | A recipient opened it |
| `DOCUMENT_SIGNED` | A recipient signed |
| `DOCUMENT_COMPLETED` | All signed, document sealed |
| `DOCUMENT_REJECTED` | A recipient rejected it |
| `DOCUMENT_CANCELLED` | Withdrawn |

### Workflow trigger events

| Event | Group | Dispatched today |
|---|---|---|
| `INBOX_EMAIL_RECEIVED` | Inbox | **Yes** |
| `INBOX_OCR_COMPLETED` | Inbox | **Yes** |
| `DMS_DOCUMENT_FILED` | DMS | **Yes** |
| `DMS_RETRIEVAL_REQUESTED` | DMS | **Yes** |
| `DMS_DOCUMENT_CLASSIFIED` | DMS | Not yet |
| `DOCUMENT_CREATED` | eSign | Not yet |
| `DOCUMENT_SENT` | eSign | Not yet |
| `DOCUMENT_OPENED` | eSign | Not yet |
| `DOCUMENT_SIGNED` | eSign | Not yet |
| `DOCUMENT_COMPLETED` | eSign | Not yet |
| `DOCUMENT_REJECTED` | eSign | Not yet |
| `DOCUMENT_CANCELLED` | eSign | Not yet |

> **Read this table before designing an integration.** The eSign events are
> selectable in the workflow builder but nothing dispatches them yet, so a
> workflow triggered on `DOCUMENT_COMPLETED` will never run. **Webhooks** on the
> same events do fire. Until the dispatch is wired, use a webhook — or the
> `INBOX_*` events, which do fire — as your trigger. See
> [Appendix B](#appendix-b--known-gaps).

### Business rule gates

| Gate | Checked |
|---|---|
| `DOCUMENT_SEND` | Before a document goes out for signature |
| `DOCUMENT_SIGN` | Before a recipient's signature is recorded |
| `INBOX_READY` | Before an inbox item is marked ready |

---

## Appendix B — Known gaps

Stated plainly so nobody designs around something that is not there.

| Gap | Effect | Workaround |
|---|---|---|
| eSign events do not dispatch to workflows | A workflow triggered on `DOCUMENT_COMPLETED` never runs | Use a webhook, or an `INBOX_*` trigger |
| `WARN` business rules are invisible to signers | A warning only reaches the server log | Use `Block` where the signer must see the message |
| No `REQUIRE_SIGNER` rule outcome | A rule cannot insert an extra approver — only block | Model as a `Block` telling the sender to add the approver, or add them in an approval chain |
| `HTTP_REQUEST` has no retry or dead-letter | A failed ERP post is recorded but not re-attempted | Queue in middleware for anything that must not be lost |
| Password-locked PDFs cannot offer certificate stripping | Those documents show a plain Download button | Download the full record |
| Inbox search is client-side | Fine at current volume; will not scale to thousands of queue items | Move to a server-side JSONB search when needed |

---

## Getting help

- **Your organization's administrators** — the first stop for access, seats,
  settings, rules and workflows
- **WorkHub console** (`console.workhubplatform.io`) — subscription, seats,
  mailboxes and domains for your tenant
- **Your service provider** — platform-level issues, and anything needing a
  tenant change you cannot make yourself
- **Audit trail** — every document carries a full audit log, visible on the
  document page under Recent activity
- **Document verification** — completed documents can be verified from the QR
  code and share link on the audit certificate
