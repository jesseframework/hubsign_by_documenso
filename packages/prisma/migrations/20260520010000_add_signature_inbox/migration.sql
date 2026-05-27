-- CreateEnum
CREATE TYPE "InboxItemStatus" AS ENUM ('RECEIVED', 'OCR_PROCESSING', 'OCR_COMPLETED', 'OCR_FAILED', 'READY', 'SENT_FOR_SIGNATURE', 'COMPLETED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "SignatureInboxItem" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "documentId" INTEGER NOT NULL,
    "status" "InboxItemStatus" NOT NULL DEFAULT 'RECEIVED',
    "senderEmail" TEXT,
    "subject" TEXT,
    "receivedById" INTEGER,
    "ocrProcessed" BOOLEAN NOT NULL DEFAULT false,
    "ocrText" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "mlConfidence" DOUBLE PRECISION,
    "documentType" TEXT,
    "ocrEngine" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "extractedData" JSONB,
    "ocrMeta" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignatureInboxItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignatureInboxItem_documentId_key" ON "SignatureInboxItem"("documentId");
CREATE INDEX "SignatureInboxItem_organizationId_idx" ON "SignatureInboxItem"("organizationId");
CREATE INDEX "SignatureInboxItem_organizationId_status_idx" ON "SignatureInboxItem"("organizationId", "status");
CREATE INDEX "SignatureInboxItem_createdAt_idx" ON "SignatureInboxItem"("createdAt");

-- AddForeignKey
ALTER TABLE "SignatureInboxItem" ADD CONSTRAINT "SignatureInboxItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
