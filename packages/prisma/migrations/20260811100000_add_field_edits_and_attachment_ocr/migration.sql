-- Human corrections to extracted fields, and OCR of a supporting attachment.
--
-- Both exist to close the same gap: a purchase-order number that the extractor
-- could not read had no other way into the system, so a rule requiring one
-- blocked signing with no remedy.

-- AlterTable: OCR results for an attachment (e.g. an attached purchase order).
ALTER TABLE "DocumentSupportingFile" ADD COLUMN     "ocrRanAt" TIMESTAMP(3),
ADD COLUMN     "ocrRanById" INTEGER,
ADD COLUMN     "ocrError" TEXT,
ADD COLUMN     "ocrDocumentType" TEXT,
ADD COLUMN     "extractedData" JSONB,
ADD COLUMN     "ocrMeta" JSONB;

-- AddForeignKey
ALTER TABLE "DocumentSupportingFile" ADD CONSTRAINT "DocumentSupportingFile_ocrRanById_fkey" FOREIGN KEY ("ocrRanById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "InboxFieldEdit" (
    "id" TEXT NOT NULL,
    "inboxItemId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "editedById" INTEGER,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboxFieldEdit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboxFieldEdit_inboxItemId_editedAt_idx" ON "InboxFieldEdit"("inboxItemId", "editedAt");

-- AddForeignKey
ALTER TABLE "InboxFieldEdit" ADD CONSTRAINT "InboxFieldEdit_inboxItemId_fkey" FOREIGN KEY ("inboxItemId") REFERENCES "SignatureInboxItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxFieldEdit" ADD CONSTRAINT "InboxFieldEdit_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
