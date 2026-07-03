-- Add normalized, system-agnostic invoice metadata to signature inbox items.
ALTER TABLE "SignatureInboxItem" ADD COLUMN "invoiceData" JSONB;
