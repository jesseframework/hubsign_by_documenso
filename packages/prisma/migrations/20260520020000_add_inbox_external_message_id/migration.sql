-- AlterTable
ALTER TABLE "SignatureInboxItem" ADD COLUMN "externalMessageId" TEXT;

-- CreateIndex
CREATE INDEX "SignatureInboxItem_externalMessageId_idx" ON "SignatureInboxItem"("externalMessageId");
