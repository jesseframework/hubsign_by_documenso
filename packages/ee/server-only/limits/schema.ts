import { z } from 'zod';

// Not proud of the below but it's a way to deal with Infinity when returning JSON.
export const ZLimitsSchema = z.object({
  documents: z
    .preprocess((v) => (v === null ? Infinity : Number(v)), z.number())
    .optional()
    .default(0),
  recipients: z
    .preprocess((v) => (v === null ? Infinity : Number(v)), z.number())
    .optional()
    .default(0),
  directTemplates: z
    .preprocess((v) => (v === null ? Infinity : Number(v)), z.number())
    .optional()
    .default(0),
  dmsEnabled: z
    .preprocess((v) => v === true || v === 'true' || v === '1', z.boolean())
    .optional()
    .default(false),
  /**
   * The window this quota resets on — 'month' (default) or 'year' (org-seat
   * annual pooling only, see `getOrgSeatLimits`). Defaulted rather than
   * required so it parses safely from Stripe Product metadata on the
   * personal-plan path (`handleUserLimits` — annual pooling is out of scope
   * there) and every pre-existing `TLimitsSchema` constant.
   */
  period: z.enum(['month', 'year']).optional().default('month'),
  /**
   * Smart OCR (BMS ML) pages included this window — org-seat tiers only,
   * see `getOrgOcrQuota`. `Infinity` (via the same null→Infinity preprocess
   * as `documents`) for tiers with no meter. Soft-stop: exhausting this
   * queues further OCR rather than blocking anything else.
   */
  ocrPages: z
    .preprocess((v) => (v === null ? Infinity : Number(v)), z.number())
    .optional()
    .default(0),
});

export type TLimitsSchema = z.infer<typeof ZLimitsSchema>;

export const ZLimitsResponseSchema = z.object({
  quota: ZLimitsSchema,
  remaining: ZLimitsSchema,
});

export type TLimitsResponseSchema = z.infer<typeof ZLimitsResponseSchema>;

export const ZLimitsErrorResponseSchema = z.object({
  error: z.string(),
});

export type TLimitsErrorResponseSchema = z.infer<typeof ZLimitsErrorResponseSchema>;
