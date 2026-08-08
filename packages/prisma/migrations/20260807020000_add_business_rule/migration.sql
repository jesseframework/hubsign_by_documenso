-- CreateEnum
CREATE TYPE "BusinessRuleGate" AS ENUM ('DOCUMENT_SEND', 'DOCUMENT_SIGN', 'INBOX_READY');

-- CreateEnum
CREATE TYPE "BusinessRuleOutcome" AS ENUM ('BLOCK', 'WARN');

-- CreateTable
CREATE TABLE "BusinessRule" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "gate" "BusinessRuleGate" NOT NULL,
    "entityType" TEXT NOT NULL DEFAULT 'Document',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "conditionConfig" JSONB NOT NULL,
    "outcome" "BusinessRuleOutcome" NOT NULL DEFAULT 'BLOCK',
    "message" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessRule_organizationId_idx" ON "BusinessRule"("organizationId");

-- CreateIndex
CREATE INDEX "BusinessRule_organizationId_gate_isActive_idx" ON "BusinessRule"("organizationId", "gate", "isActive");

-- AddForeignKey
ALTER TABLE "BusinessRule" ADD CONSTRAINT "BusinessRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessRule" ADD CONSTRAINT "BusinessRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

