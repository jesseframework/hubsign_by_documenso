-- CreateEnum
CREATE TYPE "BusinessRuleOverrideStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "BusinessRuleOverride" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "documentId" INTEGER NOT NULL,
    "status" "BusinessRuleOverrideStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "blockedReason" TEXT NOT NULL,
    "requestedByRecipientId" INTEGER,
    "approvalRequestId" TEXT,
    "decidedById" INTEGER,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessRuleOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessRuleOverrideRule" (
    "id" TEXT NOT NULL,
    "overrideId" TEXT NOT NULL,
    "ruleId" TEXT,
    "ruleName" TEXT NOT NULL,

    CONSTRAINT "BusinessRuleOverrideRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessRuleOverride_documentId_status_idx" ON "BusinessRuleOverride"("documentId", "status");

-- CreateIndex
CREATE INDEX "BusinessRuleOverride_organizationId_status_idx" ON "BusinessRuleOverride"("organizationId", "status");

-- CreateIndex
CREATE INDEX "BusinessRuleOverride_approvalRequestId_idx" ON "BusinessRuleOverride"("approvalRequestId");

-- CreateIndex
CREATE INDEX "BusinessRuleOverrideRule_ruleId_idx" ON "BusinessRuleOverrideRule"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessRuleOverrideRule_overrideId_ruleId_key" ON "BusinessRuleOverrideRule"("overrideId", "ruleId");

-- AddForeignKey
ALTER TABLE "BusinessRuleOverride" ADD CONSTRAINT "BusinessRuleOverride_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessRuleOverride" ADD CONSTRAINT "BusinessRuleOverride_requestedByRecipientId_fkey" FOREIGN KEY ("requestedByRecipientId") REFERENCES "Recipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessRuleOverride" ADD CONSTRAINT "BusinessRuleOverride_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessRuleOverrideRule" ADD CONSTRAINT "BusinessRuleOverrideRule_overrideId_fkey" FOREIGN KEY ("overrideId") REFERENCES "BusinessRuleOverride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessRuleOverrideRule" ADD CONSTRAINT "BusinessRuleOverrideRule_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "BusinessRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

