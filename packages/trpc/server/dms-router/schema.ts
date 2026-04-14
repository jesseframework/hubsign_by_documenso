import { z } from 'zod';

// ── Filing Structure Schemas ──

export const ZCreateLocationSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  description: z.string().optional(),
  teamId: z.number().optional(),
});

export const ZUpdateLocationSchema = ZCreateLocationSchema.partial().extend({
  id: z.string(),
});

export const ZCreateCabinetSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  locationId: z.string(),
});

export const ZUpdateCabinetSchema = ZCreateCabinetSchema.partial().extend({
  id: z.string(),
});

export const ZCreateShelfSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  cabinetId: z.string(),
});

export const ZUpdateShelfSchema = ZCreateShelfSchema.partial().extend({
  id: z.string(),
});

export const ZCreateBinSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  barcode: z.string().optional(),
  shelfId: z.string(),
});

export const ZUpdateBinSchema = ZCreateBinSchema.partial().extend({
  id: z.string(),
});

// ── Document Type & Classification Schemas ──

export const ZCreateDocumentTypeSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  metadataSchema: z.any().optional(),
  teamId: z.number().optional(),
});

export const ZCreateClassificationSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  color: z.string().optional(),
  parentId: z.string().optional(),
  teamId: z.number().optional(),
});

export const ZCreateTagSchema = z.object({
  name: z.string().min(1),
  teamId: z.number().optional(),
});

// ── Document Schemas ──

export const ZCreateDmsDocumentSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  fileUrl: z.string(),
  fileName: z.string(),
  fileType: z.string(),
  fileSize: z.number(),
  format: z.enum(['DIGITAL', 'PHYSICAL', 'BOTH']).optional(),
  binId: z.string().optional(),
  documentTypeId: z.string().optional(),
  classificationId: z.string().optional(),
  confidentiality: z.enum(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']).optional(),
  physicalLocation: z.string().optional(),
  metadata: z.any().optional(),
  retentionDate: z.string().datetime().optional(),
  expiryDate: z.string().datetime().optional(),
  tagIds: z.array(z.string()).optional(),
  teamId: z.number().optional(),
});

export const ZUpdateDmsDocumentSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  binId: z.string().nullable().optional(),
  documentTypeId: z.string().nullable().optional(),
  classificationId: z.string().nullable().optional(),
  confidentiality: z.enum(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']).optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'UNDER_REVIEW', 'ARCHIVED', 'DESTROYED']).optional(),
  metadata: z.any().optional(),
  retentionDate: z.string().datetime().nullable().optional(),
  expiryDate: z.string().datetime().nullable().optional(),
  tagIds: z.array(z.string()).optional(),
});

export const ZSearchDmsDocumentsSchema = z.object({
  query: z.string().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'UNDER_REVIEW', 'ARCHIVED', 'DESTROYED']).optional(),
  confidentiality: z.enum(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']).optional(),
  documentTypeId: z.string().optional(),
  classificationId: z.string().optional(),
  binId: z.string().optional(),
  tagIds: z.array(z.string()).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.number().min(1).default(1),
  perPage: z.number().min(1).max(100).default(20),
  teamId: z.number().optional(),
});

// ── Retrieval Request Schemas ──

export const ZCreateRetrievalRequestSchema = z.object({
  documentId: z.string(),
  reason: z.string().optional(),
  notes: z.string().optional(),
  dueDate: z.string().datetime().optional(),
});

export const ZUpdateRetrievalRequestSchema = z.object({
  id: z.string(),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'RETRIEVED', 'RETURNED', 'OVERDUE']),
  notes: z.string().optional(),
  returnDate: z.string().datetime().optional(),
});

// ── Filing Rule Schemas ──

export const ZCreateFilingRuleSchema = z.object({
  name: z.string().min(1),
  condition: z.any(),
  binId: z.string().optional(),
  documentTypeId: z.string().optional(),
  classificationId: z.string().optional(),
  active: z.boolean().optional(),
  teamId: z.number().optional(),
});

// ── Comment Schemas ──

export const ZCreateCommentSchema = z.object({
  documentId: z.string(),
  text: z.string().min(1),
});

// ── Version Schemas ──

export const ZCreateVersionSchema = z.object({
  documentId: z.string(),
  fileUrl: z.string(),
  fileSize: z.number(),
  notes: z.string().optional(),
});
