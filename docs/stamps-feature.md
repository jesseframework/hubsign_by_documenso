# Stamps — Premium Document Stamps Feature

**Status (2026-04-21):** Slice 1 schema landed (Stamp model + migration `20260421010000_add_stamps`). UI, tRPC, S3 upload, PDF overlay, canvas editor, and AI Studio are pending.

A reusable, brandable, premium-gated stamp system with three construction paths (upload → designed → AI-generated) all producing the same `Stamp` record so the apply-to-PDF pipeline is one path.

---

## Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Trust model | Per-user / per-team scoped | Personal stamps for individuals, shared library for teams. Org-level optional later. |
| Construction kinds | UPLOADED, DESIGNED, AI_GENERATED | Three UX paths, one data shape. |
| Canvas library | **Fabric.js** | Mature, supports text + images + shapes, well-documented, ~110KB gzipped. Same canvas builds and applies stamps. |
| AI provider | Anthropic Claude (Sonnet) returning structured JSON via tool-use | TS SDK already familiar; structured-output reliability via `tool_use` schema. |
| Asset storage | S3 (existing transport) | Reuses `NEXT_PUBLIC_UPLOAD_TRANSPORT` infra. |
| Premium gate | Subscription plan tier check | HubSign already has `IS_BILLING_ENABLED` and Stripe integration. |
| PDF embed | pdf-lib `embedPng` / `drawImage` | Same path as signature images; rasterize Fabric canvas → PNG → embed. |

---

## Data model (already shipped)

```prisma
enum StampKind { UPLOADED DESIGNED AI_GENERATED }

model Stamp {
  id           String    @id @default(cuid())
  userId       Int?
  teamId       Int?
  name         String
  kind         StampKind
  imageAssetId String?     // S3 key for UPLOADED
  layout       Json?       // Fabric.js JSON for DESIGNED / AI_GENERATED
  placeholders String[]    // ['{date}','{signer.name}'] resolved at apply time
  previewImage String?     // S3 key for thumbnail
  isPremium    Boolean     @default(true)
  createdAt    DateTime    @default(now())
  updatedAt    DateTime    @updatedAt
  user         User?       @relation(fields: [userId], references: [id], onDelete: Cascade)
  team         Team?       @relation(fields: [teamId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@index([teamId])
}
```

Migration: [packages/prisma/migrations/20260421010000_add_stamps/migration.sql](../packages/prisma/migrations/20260421010000_add_stamps/migration.sql) — applied to dev DB.

User + Team relations: added `stamps Stamp[]` on both.

---

## Slice 1 — Upload path + apply-to-PDF (1 week)

Ship a vertical slice: a user can upload a PNG/JPG/SVG, see it in their stamp library, drag it onto a document, and have it appear in the sealed PDF.

### 1.1 Premium gate helper

Use HubSign's existing subscription helpers:

```ts
// packages/lib/server-only/stamps/has-premium-stamps.ts
import { getActiveSubscriptionsByUserId } from '../subscription/get-active-subscriptions-by-user-id';
import { isCommunityPlan } from '../subscription/is-community-plan';

export async function hasPremiumStamps(userId: number, teamId?: number): Promise<boolean> {
  if (teamId) {
    // Team subs unlock for all members.
    return hasActiveTeamSubscription(teamId);
  }
  const subs = await getActiveSubscriptionsByUserId({ userId });
  return subs.some((s) => !isCommunityPlan(s));
}
```

Throw a typed error from tRPC procedures when `hasPremiumStamps` returns false:

```ts
import { TRPCError } from '@trpc/server';
if (!await hasPremiumStamps(ctx.user.id, input.teamId)) {
  throw new TRPCError({ code: 'FORBIDDEN', message: 'STAMP_REQUIRES_PREMIUM' });
}
```

UI catches `STAMP_REQUIRES_PREMIUM` → renders an upgrade CTA inline.

### 1.2 S3 upload helper for stamps

Reuse existing upload infra:

```ts
// packages/lib/server-only/stamps/upload-stamp-asset.ts
import { putFileServerSide } from '../../universal/upload/put-file.server';

export async function uploadStampAsset(file: File, userId: number) {
  const key = `stamps/${userId}/${crypto.randomUUID()}-${file.name}`;
  return putFileServerSide(file, { key });
}
```

Constraints:
- Allowed MIME: `image/png`, `image/jpeg`, `image/svg+xml`
- Max size: 2 MB
- Min dimensions: 100x50, max: 2000x2000
- Strip EXIF (use `sharp`, already a dep) and re-encode PNGs to defeat malicious payloads
- Reject SVGs containing `<script>` or external `<image>` refs (use `xmldom` + tag-allowlist)

### 1.3 tRPC stamp router

```ts
// packages/trpc/server/stamp-router/router.ts
export const stampRouter = router({
  list: authenticatedProcedure
    .input(z.object({ teamId: z.number().int().optional() }))
    .query(async ({ ctx, input }) => {
      // Returns user's personal stamps + their team's stamps if teamId given.
    }),

  createUploaded: authenticatedProcedure
    .input(z.object({
      name: z.string().min(1).max(80),
      teamId: z.number().int().optional(),
      assetId: z.string(),     // result of upload-stamp-asset
      placeholders: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertPremium(ctx, input.teamId);
      return prisma.stamp.create({
        data: {
          name: input.name,
          kind: 'UPLOADED',
          imageAssetId: input.assetId,
          previewImage: input.assetId,    // upload IS the preview
          placeholders: input.placeholders ?? [],
          userId: input.teamId ? null : ctx.user.id,
          teamId: input.teamId ?? null,
        },
      });
    }),

  createDesigned: authenticatedProcedure
    .input(/* layout JSON + name + previewDataUrl */)
    .mutation(/* ... store layout, render preview from canvas, save preview to S3 */),

  delete: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(/* verify ownership, delete row + S3 assets */),
});
```

Register in [packages/trpc/server/router.ts](../packages/trpc/server/router.ts) as `stamp: stampRouter`.

### 1.4 PDF overlay helper

```ts
// packages/lib/server-only/stamps/embed-stamp-on-pdf.ts
import { PDFDocument } from 'pdf-lib';
import { getFileServerSide } from '../../universal/upload/get-file.server';

type StampPlacement = {
  stampId: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;     // degrees
  opacity?: number;      // 0..1
};

export async function embedStampOnPdf(doc: PDFDocument, placements: StampPlacement[]) {
  const stamps = await prisma.stamp.findMany({
    where: { id: { in: placements.map((p) => p.stampId) } },
  });

  for (const placement of placements) {
    const stamp = stamps.find((s) => s.id === placement.stampId);
    if (!stamp) continue;

    // For Slice 1 we only handle UPLOADED stamps. Slice 2 will handle
    // DESIGNED/AI_GENERATED by rasterizing the Fabric layout server-side.
    if (stamp.kind !== 'UPLOADED' || !stamp.imageAssetId) continue;

    const png = await getFileServerSide({ id: stamp.imageAssetId } as any);
    const image = await doc.embedPng(png);
    const page = doc.getPages()[placement.pageIndex];
    page.drawImage(image, {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      rotate: placement.rotation ? degrees(placement.rotation) : undefined,
      opacity: placement.opacity ?? 1,
    });
  }
}
```

Hook into [seal-document.ts](../packages/lib/server-only/document/seal-document.ts) right after the existing field insertion loop, before `flattenForm` and `signPdf`.

### 1.5 Where placements come from

A `DocumentStampPlacement` table joins documents to stamps with positions. For Slice 1, you can prototype with placements stored on the Field table or in a Json column on Document. Recommended:

```prisma
model DocumentStampPlacement {
  id         String   @id @default(cuid())
  documentId Int
  stampId    String
  pageIndex  Int
  x          Float
  y          Float
  width      Float
  height     Float
  rotation   Float?
  opacity    Float?
  createdAt  DateTime @default(now())
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
  stamp      Stamp    @relation(fields: [stampId], references: [id], onDelete: Restrict)
  @@index([documentId])
}
```

Add to schema in Slice 1.5 along with the editing UI.

### 1.6 UI — Stamp library settings page

Mirror the existing [/settings/profile.tsx](../apps/remix/app/routes/_authenticated+/settings+/profile.tsx) shape:

```
/settings/stamps                   ← personal library
/t/$teamUrl/settings/stamps        ← team library
```

Components:
- `<StampLibrary />` — grid of preview thumbnails, each clickable for edit/delete
- `<StampUploadDialog />` — file picker, name input, preview, "Save" button (calls `trpc.stamp.createUploaded.useMutation()`)
- Premium-gate banner if `hasPremiumStamps` returns false

Reference HubSign's existing per-user settings page pattern (e.g. [public-profile.tsx](../apps/remix/app/routes/_authenticated+/settings+/public-profile.tsx)).

### 1.7 UI — Stamp picker on document editor

In the document edit view (where users place fields), add a "Stamp" tool to the toolbar that opens a popover with the user's stamp library. Drag a stamp onto the page like a field. Saves a `DocumentStampPlacement` row.

---

## Slice 2 — Canvas editor for DESIGNED stamps (1 week)

Ships the in-app canvas where users build stamps from scratch.

### 2.1 Element palette

- **Text** — value, font family, size, color, alignment, bold/italic
- **Dynamic text** — placeholder picker (`{date}`, `{date.long}`, `{time}`, `{signer.name}`, `{signer.email}`, `{document.title}`, `{company.name}`, `{user.name}`)
- **Image** — upload (becomes a logo asset) or pick from team logos
- **Shape** — rectangle, ellipse, line — fill, stroke, opacity
- **Background** — none, solid, border (rect/circle), with stroke width

### 2.2 Canvas state

```ts
type StampElement =
  | { id: string; type: 'text'; text: string; x: number; y: number; w: number; h: number; font: string; size: number; color: string; bold?: boolean; italic?: boolean; align?: 'left'|'center'|'right'; placeholder?: string }
  | { id: string; type: 'image'; assetId: string; x: number; y: number; w: number; h: number; opacity?: number }
  | { id: string; type: 'shape'; shape: 'rect'|'ellipse'|'line'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; strokeWidth?: number };

type StampLayout = {
  width: number;          // canvas width in pt (default 200)
  height: number;         // canvas height in pt (default 100)
  background?: { fill?: string; border?: { color: string; width: number; radius?: number; shape: 'rect'|'circle' } };
  elements: StampElement[];
};
```

Stored in `Stamp.layout`. Derive `placeholders` array on save by walking elements for `placeholder` values.

### 2.3 Server-side rasterization

When a DESIGNED/AI_GENERATED stamp is applied to a PDF, the placeholder values must be resolved (today's date, the signer's name) and the canvas rendered. Two options:

**Option A — Render in browser, send PNG to server**: simpler, but trusting client output is dangerous for stamps used in legal docs.

**Option B — Server-side rasterization with `node-canvas` + a small custom renderer**: more code but deterministic and tamper-resistant.

Go with Option B. ~150 lines of code:

```ts
// packages/lib/server-only/stamps/rasterize-stamp.ts
import { createCanvas, loadImage } from '@napi-rs/canvas';

export async function rasterizeStamp(layout: StampLayout, context: PlaceholderContext, scale = 4): Promise<Buffer> {
  const canvas = createCanvas(layout.width * scale, layout.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  // background
  if (layout.background?.fill) { ctx.fillStyle = layout.background.fill; ctx.fillRect(0, 0, layout.width, layout.height); }
  if (layout.background?.border) { /* draw border per shape */ }

  for (const el of layout.elements) {
    if (el.type === 'text') {
      const text = el.placeholder ? resolvePlaceholder(el.placeholder, context) : el.text;
      ctx.font = `${el.bold ? 'bold ' : ''}${el.italic ? 'italic ' : ''}${el.size}px ${el.font}`;
      ctx.fillStyle = el.color;
      ctx.fillText(text, el.x, el.y + el.size);
    }
    if (el.type === 'image') { const img = await loadImage(await getAsset(el.assetId)); ctx.drawImage(img, el.x, el.y, el.w, el.h); }
    if (el.type === 'shape') { /* ... */ }
  }

  return canvas.toBuffer('image/png');
}
```

`@napi-rs/canvas` is fast, prebuilt for arm64+x64 macOS+linux, works in the existing Node deployment.

### 2.4 Placeholder catalog

```ts
// packages/lib/server-only/stamps/placeholders.ts
export const PLACEHOLDERS = {
  '{date}':           ({ now }) => now.toFormat('yyyy-MM-dd'),
  '{date.long}':      ({ now }) => now.toFormat('LLLL d, yyyy'),
  '{time}':           ({ now }) => now.toFormat('HH:mm'),
  '{signer.name}':    ({ recipient }) => recipient?.name ?? '',
  '{signer.email}':   ({ recipient }) => recipient?.email ?? '',
  '{document.title}': ({ document }) => document.title,
  '{document.id}':    ({ document }) => String(document.id),
  '{company.name}':   ({ team }) => team?.name ?? '',
  '{user.name}':      ({ user }) => user?.name ?? '',
};
```

UI exposes these as autocomplete suggestions in the text-element editor.

---

## Slice 3 — AI Studio (1 week)

Natural-language → canvas layout. Reuses the same `Stamp` model.

### 3.1 Tool-use schema for Claude

Use Anthropic's Tool Use feature to enforce structured output:

```ts
// packages/lib/server-only/stamps/ai-generate-stamp.ts
import Anthropic from '@anthropic-ai/sdk';

const STAMP_LAYOUT_TOOL = {
  name: 'render_stamp_layout',
  description: 'Produce a stamp layout JSON spec',
  input_schema: {
    type: 'object',
    required: ['width', 'height', 'elements'],
    properties: {
      width: { type: 'number', minimum: 50, maximum: 400 },
      height: { type: 'number', minimum: 50, maximum: 400 },
      background: { /* ... */ },
      elements: {
        type: 'array',
        maxItems: 12,
        items: {
          oneOf: [
            { type: 'object', required: ['type','text','x','y'], properties: { type: { const: 'text' }, ... } },
            { type: 'object', required: ['type','shape','x','y','w','h'], properties: { type: { const: 'shape' }, ... } },
          ],
        },
      },
    },
  },
};

export async function generateStampFromPrompt(prompt: string, context: { companyName?: string }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    tools: [STAMP_LAYOUT_TOOL],
    tool_choice: { type: 'tool', name: 'render_stamp_layout' },
    messages: [
      { role: 'user', content: buildSystemPrompt(prompt, context) },
    ],
  });

  const toolUse = resp.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
  if (!toolUse) throw new Error('AI did not return a layout');
  return StampLayoutSchema.parse(toolUse.input);   // zod-validate before saving
}
```

### 3.2 Cost controls

- Rate-limit per user: 10 generations / day on premium plans (`rate-limiter-flexible`)
- Hard cap: 50 stamps total per user (delete one to make a new AI stamp)
- Cache identical prompts for 24h (use `redis` SET with prompt hash)
- Show estimated cost in UI before generation: `"this will use 1 credit (≈ 1¢)"`

### 3.3 UI — AI Studio

`/settings/stamps/new/ai`:
- Big textarea for the prompt
- Optional context: company name, primary color, existing logo
- "Generate" button → spinner (~3-5s) → canvas opens with the AI's layout pre-filled
- User tweaks freely → "Save"
- Stamp record gets `kind: AI_GENERATED` + `metadata.aiPrompt` for provenance

### 3.4 Safety

- Reject prompts containing the words "real", "official", "government" (heuristic — block stamps that pretend to be from authorities)
- Watermark AI_GENERATED stamps with a tiny "AI" indicator on the library thumbnail (so admins/customers can distinguish)
- Audit log every generation with `userId, prompt, layoutJson, ts`

---

## Apply pipeline (final state)

```
User opens document editor
    │
    ▼
Toolbar "Stamp" → popover with library
    │
    ▼
User drags stamp onto page → DocumentStampPlacement created
    │
    ▼
Doc reaches "all signed" → seal-document.ts triggers
    │
    ├─► For each placement:
    │     ├─ if Stamp.kind === UPLOADED:
    │     │     load imageAssetId from S3 → embedPng → drawImage
    │     │
    │     └─ if DESIGNED / AI_GENERATED:
    │           rasterizeStamp(layout, context) → embedPng → drawImage
    │
    ▼
PDF flattened, signed, encrypted, uploaded
```

---

## Testing checklist (per slice)

**Slice 1**
- [ ] Free user → stamp library page shows upgrade CTA, list returns []
- [ ] Premium user → can upload PNG, JPG, SVG; rejects 5MB+ files; rejects malicious SVG
- [ ] Stamp appears in library; preview thumbnail loads
- [ ] Place on doc → DocumentStampPlacement row created
- [ ] Seal doc → sealed PDF contains the stamp at correct position
- [ ] Delete stamp → S3 asset purged, library updates

**Slice 2**
- [ ] Canvas editor saves layout JSON correctly; round-trip lossless
- [ ] Placeholders resolve at apply time (date is today's date)
- [ ] Server-side rasterizer matches client preview within 5px tolerance

**Slice 3**
- [ ] Identical prompt within 24h returns cached result
- [ ] Daily cap enforced
- [ ] AI failure → friendly error, no Stamp row created
- [ ] AI_GENERATED stamps have `metadata.aiPrompt` populated

---

## Files touched / to touch

**Slice 1 schema (DONE):**
- [packages/prisma/schema.prisma](../packages/prisma/schema.prisma) — added Stamp model + StampKind enum + relations on User and Team
- [packages/prisma/migrations/20260421010000_add_stamps/migration.sql](../packages/prisma/migrations/20260421010000_add_stamps/migration.sql)

**Slice 1 remaining:**
- `packages/lib/server-only/stamps/has-premium-stamps.ts` — premium gate
- `packages/lib/server-only/stamps/upload-stamp-asset.ts` — S3 upload helper
- `packages/lib/server-only/stamps/embed-stamp-on-pdf.ts` — pdf-lib overlay
- `packages/trpc/server/stamp-router/router.ts` — list / createUploaded / delete
- `packages/trpc/server/router.ts` — register stampRouter
- `apps/remix/app/routes/_authenticated+/settings+/stamps.tsx` — library page
- `apps/remix/app/components/forms/stamp-upload-dialog.tsx`
- `apps/remix/app/components/general/document/document-stamp-picker.tsx` — toolbar dropdown
- `packages/prisma/migrations/<next>_add_document_stamp_placements/migration.sql` — placements table
- `packages/lib/server-only/document/seal-document.ts` — call `embedStampOnPdf` before flattening

**Slice 2 remaining:**
- `apps/remix/app/components/general/stamps/stamp-canvas-editor.tsx` — Fabric.js editor
- `packages/lib/server-only/stamps/rasterize-stamp.ts` — server-side renderer
- `packages/lib/server-only/stamps/placeholders.ts` — token resolver
- `apps/remix/package.json` — add `fabric`, `@napi-rs/canvas`

**Slice 3 remaining:**
- `packages/lib/server-only/stamps/ai-generate-stamp.ts` — Anthropic call
- `apps/remix/app/routes/_authenticated+/settings+/stamps.new.ai.tsx`
- `packages/lib/server-only/stamps/stamp-layout-schema.ts` — shared zod schema (used by AI tool-use + canvas + rasterizer)
- env: `ANTHROPIC_API_KEY` in `.env.example`

---

## Estimated total effort

| Slice | Time | Cumulative |
|---|---|---|
| Slice 1 — Upload + apply at seal | 1 week | 1 wk |
| Slice 2 — Canvas editor + rasterize | 1.5 weeks | 2.5 wk |
| Slice 3 — AI Studio | 1 week | 3.5 wk |

Plus **0.5 week** for QA, premium-gate edge cases, and team-vs-personal scope rules.

**Total: ~4 weeks for a senior dev** to ship a polished premium stamp feature with all three construction paths.
