-- CreateEnum
CREATE TYPE "OcrUsageSource" AS ENUM ('INBOX', 'ATTACHMENT', 'DMS');

-- CreateEnum
CREATE TYPE "OcrUsageStatus" AS ENUM ('PROCESSED', 'QUEUED');

-- AlterEnum
ALTER TYPE "InboxItemStatus" ADD VALUE 'OCR_QUEUED';

-- AlterTable
ALTER TABLE "DmsDocument" ADD COLUMN     "ocrQueuedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "DocumentSupportingFile" ADD COLUMN     "ocrQueuedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OrgOcrUsage" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "source" "OcrUsageSource" NOT NULL,
    "status" "OcrUsageStatus" NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "sourceId" TEXT NOT NULL,
    "triggeredById" INTEGER,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgOcrUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgOcrUsage_organizationId_createdAt_idx" ON "OrgOcrUsage"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "OrgOcrUsage_organizationId_status_idx" ON "OrgOcrUsage"("organizationId", "status");

-- CreateIndex
CREATE INDEX "OrgOcrUsage_sourceId_idx" ON "OrgOcrUsage"("sourceId");

-- AddForeignKey
ALTER TABLE "OrgOcrUsage" ADD CONSTRAINT "OrgOcrUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgOcrUsage" ADD CONSTRAINT "OrgOcrUsage_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

