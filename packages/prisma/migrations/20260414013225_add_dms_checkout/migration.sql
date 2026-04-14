-- AlterTable
ALTER TABLE "DmsDocument" ADD COLUMN     "checkedOut" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "checkedOutAt" TIMESTAMP(3),
ADD COLUMN     "checkedOutById" INTEGER,
ADD COLUMN     "checkoutNotes" TEXT;

-- AddForeignKey
ALTER TABLE "DmsDocument" ADD CONSTRAINT "DmsDocument_checkedOutById_fkey" FOREIGN KEY ("checkedOutById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
