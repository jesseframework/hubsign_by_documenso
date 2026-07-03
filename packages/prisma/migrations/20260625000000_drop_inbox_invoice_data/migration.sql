-- Revert: the canonical invoice-metadata column is replaced by dynamic ML field display (ocrMeta.fieldExtractions).
ALTER TABLE "SignatureInboxItem" DROP COLUMN IF EXISTS "invoiceData";
