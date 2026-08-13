-- The size a signer chose for their signature within its field, as a fraction of
-- the field, 0.3–1.
--
-- Nullable with no default on purpose: null means "signed before this existed",
-- and the renderer keeps the original fit-the-field-never-enlarge behaviour for
-- those rows so an already-signed document does not change shape when resealed.

-- AlterTable
ALTER TABLE "Signature" ADD COLUMN     "signatureFill" DECIMAL(65,30);
