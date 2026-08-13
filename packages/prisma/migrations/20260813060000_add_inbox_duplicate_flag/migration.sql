-- AlterTable
ALTER TABLE "SignatureInboxItem" ADD COLUMN     "duplicateCheckedAt" TIMESTAMP(3),
ADD COLUMN     "duplicateCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "duplicateMatchedOn" TEXT,
ADD COLUMN     "duplicateOfId" TEXT;

-- CreateIndex
CREATE INDEX "SignatureInboxItem_duplicateOfId_idx" ON "SignatureInboxItem"("duplicateOfId");

-- AddForeignKey
ALTER TABLE "SignatureInboxItem" ADD CONSTRAINT "SignatureInboxItem_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "SignatureInboxItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
