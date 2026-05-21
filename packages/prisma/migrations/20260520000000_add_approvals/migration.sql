-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalFlowStatus" AS ENUM ('PENDING', 'EMAIL_SENT', 'EMAIL_READ', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalDetermination" AS ENUM ('FIXED_USER', 'ORG_ROLE', 'ROLE_MAPPING', 'REPORTING_MANAGER', 'DEPARTMENT_HEAD');

-- CreateEnum
CREATE TYPE "ApprovalValidationSeverity" AS ENUM ('CRITICAL', 'ERROR', 'WARNING', 'INFO');

-- CreateEnum
CREATE TYPE "ApprovalOnApproveAction" AS ENUM ('NONE', 'MARK_APPROVED', 'SEND_FOR_SIGNATURE');

-- AlterTable: manager hierarchy on OrganizationMember
ALTER TABLE "OrganizationMember"
    ADD COLUMN "managerId" TEXT,
    ADD COLUMN "department" TEXT,
    ADD COLUMN "isDepartmentHead" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ApprovalTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entityType" TEXT NOT NULL DEFAULT 'Document',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "triggerStatus" TEXT,
    "onApproveAction" "ApprovalOnApproveAction" NOT NULL DEFAULT 'MARK_APPROVED',
    "nextTemplateId" TEXT,
    "nextRuleSetId" TEXT,
    "rejectionTemplateId" TEXT,
    "config" JSONB,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "determination" "ApprovalDetermination" NOT NULL DEFAULT 'FIXED_USER',
    "approverRole" "OrganizationRole",
    "fixedUserId" INTEGER,
    "roleMappingKey" TEXT,
    "department" TEXT,
    "isParallel" BOOLEAN NOT NULL DEFAULT false,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "isEnd" BOOLEAN NOT NULL DEFAULT false,
    "enableReminders" BOOLEAN NOT NULL DEFAULT false,
    "firstReminderAfterHours" INTEGER,
    "secondReminderAfterHours" INTEGER,
    "escalationAfterHours" INTEGER,
    "reminderIntervalHours" INTEGER,
    "escalationRecipients" TEXT,
    "config" JSONB,

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "templateId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "priority" TEXT,
    "amount" DOUBLE PRECISION,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "requestedById" INTEGER,
    "documentFileId" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalFlowRecord" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "stepName" TEXT,
    "approverId" INTEGER,
    "approverName" TEXT,
    "approverEmail" TEXT NOT NULL,
    "approverRole" TEXT,
    "isParallel" BOOLEAN NOT NULL DEFAULT false,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "status" "ApprovalFlowStatus" NOT NULL DEFAULT 'PENDING',
    "token" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actionedAt" TIMESTAMP(3),
    "decision" TEXT,
    "comments" TEXT,
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalFlowRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRuleSet" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "entityType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRuleSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRule" (
    "id" TEXT NOT NULL,
    "ruleSetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "conditionConfig" JSONB NOT NULL,
    "templateId" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRoleMapping" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "roleType" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "approvalLevel" INTEGER NOT NULL DEFAULT 1,
    "primaryApproverId" INTEGER NOT NULL,
    "backupApproverId" INTEGER,
    "reminderHours" INTEGER,
    "expiryHours" INTEGER,
    "isParallel" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRoleMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalValidationRule" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "validationType" TEXT NOT NULL,
    "conditionConfig" JSONB NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "severity" "ApprovalValidationSeverity" NOT NULL DEFAULT 'ERROR',
    "entityType" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalValidationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStepValidation" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "validationRuleId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ApprovalStepValidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalReminderHistory" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "flowRecordId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "reminderType" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "responseAction" TEXT,
    "responseTimeHours" DOUBLE PRECISION,
    "entityType" TEXT,
    "entityAmount" DOUBLE PRECISION,

    CONSTRAINT "ApprovalReminderHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganizationMember_managerId_idx" ON "OrganizationMember"("managerId");
CREATE INDEX "OrganizationMember_organizationId_department_idx" ON "OrganizationMember"("organizationId", "department");

-- CreateIndex
CREATE INDEX "ApprovalTemplate_organizationId_idx" ON "ApprovalTemplate"("organizationId");
CREATE INDEX "ApprovalTemplate_organizationId_entityType_isActive_idx" ON "ApprovalTemplate"("organizationId", "entityType", "isActive");
CREATE INDEX "ApprovalTemplate_organizationId_entityType_isDefault_idx" ON "ApprovalTemplate"("organizationId", "entityType", "isDefault");

-- CreateIndex
CREATE INDEX "ApprovalStep_templateId_idx" ON "ApprovalStep"("templateId");
CREATE INDEX "ApprovalStep_templateId_stepNumber_idx" ON "ApprovalStep"("templateId", "stepNumber");

-- CreateIndex
CREATE INDEX "ApprovalRequest_organizationId_idx" ON "ApprovalRequest"("organizationId");
CREATE INDEX "ApprovalRequest_organizationId_status_idx" ON "ApprovalRequest"("organizationId", "status");
CREATE INDEX "ApprovalRequest_entityType_entityId_idx" ON "ApprovalRequest"("entityType", "entityId");
CREATE INDEX "ApprovalRequest_entityType_entityId_status_idx" ON "ApprovalRequest"("entityType", "entityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalFlowRecord_token_key" ON "ApprovalFlowRecord"("token");
CREATE INDEX "ApprovalFlowRecord_requestId_idx" ON "ApprovalFlowRecord"("requestId");
CREATE INDEX "ApprovalFlowRecord_requestId_stepOrder_idx" ON "ApprovalFlowRecord"("requestId", "stepOrder");
CREATE INDEX "ApprovalFlowRecord_approverEmail_idx" ON "ApprovalFlowRecord"("approverEmail");
CREATE INDEX "ApprovalFlowRecord_status_idx" ON "ApprovalFlowRecord"("status");

-- CreateIndex
CREATE INDEX "ApprovalRuleSet_organizationId_idx" ON "ApprovalRuleSet"("organizationId");
CREATE INDEX "ApprovalRuleSet_organizationId_entityType_isActive_idx" ON "ApprovalRuleSet"("organizationId", "entityType", "isActive");

-- CreateIndex
CREATE INDEX "ApprovalRule_ruleSetId_idx" ON "ApprovalRule"("ruleSetId");
CREATE INDEX "ApprovalRule_ruleSetId_isActive_priority_idx" ON "ApprovalRule"("ruleSetId", "isActive", "priority");

-- CreateIndex
CREATE INDEX "ApprovalRoleMapping_organizationId_idx" ON "ApprovalRoleMapping"("organizationId");
CREATE UNIQUE INDEX "ApprovalRoleMapping_organizationId_roleType_roleKey_approval_key" ON "ApprovalRoleMapping"("organizationId", "roleType", "roleKey", "approvalLevel");

-- CreateIndex
CREATE INDEX "ApprovalValidationRule_organizationId_idx" ON "ApprovalValidationRule"("organizationId");
CREATE INDEX "ApprovalValidationRule_organizationId_isActive_validationType_idx" ON "ApprovalValidationRule"("organizationId", "isActive", "validationType");
CREATE INDEX "ApprovalValidationRule_entityType_idx" ON "ApprovalValidationRule"("entityType");

-- CreateIndex
CREATE INDEX "ApprovalStepValidation_stepId_idx" ON "ApprovalStepValidation"("stepId");
CREATE INDEX "ApprovalStepValidation_validationRuleId_idx" ON "ApprovalStepValidation"("validationRuleId");
CREATE INDEX "ApprovalStepValidation_stepId_priority_idx" ON "ApprovalStepValidation"("stepId", "priority");

-- CreateIndex
CREATE INDEX "ApprovalReminderHistory_requestId_idx" ON "ApprovalReminderHistory"("requestId");
CREATE INDEX "ApprovalReminderHistory_flowRecordId_idx" ON "ApprovalReminderHistory"("flowRecordId");
CREATE INDEX "ApprovalReminderHistory_sentAt_idx" ON "ApprovalReminderHistory"("sentAt");
CREATE INDEX "ApprovalReminderHistory_recipientEmail_idx" ON "ApprovalReminderHistory"("recipientEmail");

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "OrganizationMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ApprovalTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ApprovalTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalFlowRecord" ADD CONSTRAINT "ApprovalFlowRecord_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRule" ADD CONSTRAINT "ApprovalRule_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "ApprovalRuleSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStepValidation" ADD CONSTRAINT "ApprovalStepValidation_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "ApprovalStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStepValidation" ADD CONSTRAINT "ApprovalStepValidation_validationRuleId_fkey" FOREIGN KEY ("validationRuleId") REFERENCES "ApprovalValidationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalReminderHistory" ADD CONSTRAINT "ApprovalReminderHistory_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalReminderHistory" ADD CONSTRAINT "ApprovalReminderHistory_flowRecordId_fkey" FOREIGN KEY ("flowRecordId") REFERENCES "ApprovalFlowRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;
