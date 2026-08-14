import { DocumentAnnotationType } from '@prisma/client';
import { z } from 'zod';

/**
 * PDF markup — the shapes shared by the tRPC router and the overlay that draws
 * them.
 *
 * Every coordinate in here is a PERCENTAGE of the rendered page box (0-100)
 * with the origin at the TOP-LEFT, which is the convention `Field` and
 * `DocumentStampPlacement` already use. Percentages are what let markup drawn
 * at 150% zoom on a laptop land in the same spot on a phone, and what lets the
 * seal path map into PDF user space (origin lower-left) without knowing
 * anything about the viewport it was drawn in.
 *
 * There is deliberately no freehand pen: a hand-drawn stroke on a signing page
 * cannot be told apart from a signature by anyone reading the finished
 * document, and it carries none of a signature's authentication or audit trail.
 */

/** A hex colour, validated rather than trusted — it reaches both an SVG
 * attribute in the browser and a pdf-lib colour at seal time. */
export const ZAnnotationColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Colour must be a 6-digit hex value');

const ZPercent = z.number().min(0).max(100);

export const ANNOTATION_MAX_NOTE_LENGTH = 2000;

export const ZDocumentAnnotation = z.object({
  id: z.string(),
  pageIndex: z.number().int().min(0),
  type: z.nativeEnum(DocumentAnnotationType),
  x: ZPercent,
  y: ZPercent,
  width: z.number().min(0).max(100),
  height: z.number().min(0).max(100),
  text: z.string().nullable(),
  color: z.string(),
  opacity: z.number().min(0).max(1),
  fontSize: z.number().min(0).nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.date(),
  /**
   * Whether the current viewer added this one. Resolved server-side per request
   * — a viewer may edit and delete their own markup but only look at everyone
   * else's, and the client should not be the thing deciding that.
   */
  isOwn: z.boolean(),
});

export type TDocumentAnnotation = z.infer<typeof ZDocumentAnnotation>;

/**
 * Creation payload. `type` decides which fields carry meaning, and
 * `refineAnnotationShape` below enforces that — a NOTE without text is a bug on
 * the way to an invisible row.
 */
export const ZCreateAnnotationShape = z.object({
  pageIndex: z.number().int().min(0).max(5000),
  type: z.nativeEnum(DocumentAnnotationType),
  x: ZPercent,
  y: ZPercent,
  width: z.number().min(0).max(100),
  height: z.number().min(0).max(100),
  text: z.string().trim().max(ANNOTATION_MAX_NOTE_LENGTH).optional(),
  color: ZAnnotationColor.optional(),
  opacity: z.number().min(0.05).max(1).optional(),
  fontSize: z.number().min(0.2).max(10).optional(),
});

export type TCreateAnnotationShape = z.infer<typeof ZCreateAnnotationShape>;

export const refineAnnotationShape = (
  value: TCreateAnnotationShape,
  ctx: z.RefinementCtx,
): void => {
  if (value.type === DocumentAnnotationType.NOTE && !value.text) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['text'],
      message: 'A note annotation needs text.',
    });
  }
};

/** Defaults applied when the client leaves styling off the payload. */
export const ANNOTATION_STYLE_DEFAULTS = {
  [DocumentAnnotationType.HIGHLIGHT]: { color: '#FACC15', opacity: 0.4 },
  [DocumentAnnotationType.NOTE]: { color: '#2563EB', opacity: 1 },
} as const;

/** The palette offered in the toolbar. */
export const ANNOTATION_COLORS = [
  '#FACC15',
  '#4ADE80',
  '#38BDF8',
  '#F472B6',
  '#DC2626',
  '#1E293B',
] as const;
