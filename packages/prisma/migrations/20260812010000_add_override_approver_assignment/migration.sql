-- AlterTable
ALTER TABLE "BusinessRuleOverride" ADD COLUMN     "approverRoleKey" TEXT,
ADD COLUMN     "approverRoleType" TEXT,
ADD COLUMN     "assignedApproverId" INTEGER;

-- CreateIndex
CREATE INDEX "BusinessRuleOverride_assignedApproverId_status_idx" ON "BusinessRuleOverride"("assignedApproverId", "status");

-- AddForeignKey
ALTER TABLE "BusinessRuleOverride" ADD CONSTRAINT "BusinessRuleOverride_assignedApproverId_fkey" FOREIGN KEY ("assignedApproverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

