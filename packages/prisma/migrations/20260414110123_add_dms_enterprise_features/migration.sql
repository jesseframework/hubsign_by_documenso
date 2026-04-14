-- CreateEnum
CREATE TYPE "DmsWorkflowStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DmsWorkflowStepStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "DmsPermissionLevel" AS ENUM ('VIEW', 'DOWNLOAD', 'EDIT', 'DELETE', 'ADMIN');

-- CreateTable
CREATE TABLE "DmsWorkflow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "DmsWorkflowStatus" NOT NULL DEFAULT 'PENDING',
    "documentId" TEXT NOT NULL,
    "initiatedById" INTEGER NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 1,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DmsWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsWorkflowStep" (
    "id" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'APPROVE',
    "status" "DmsWorkflowStepStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "dueDate" TIMESTAMP(3),
    "workflowId" TEXT NOT NULL,
    "assignedToId" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DmsWorkflowStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsPermission" (
    "id" TEXT NOT NULL,
    "level" "DmsPermissionLevel" NOT NULL,
    "locationId" TEXT,
    "documentId" TEXT,
    "classificationId" TEXT,
    "userId" INTEGER NOT NULL,
    "grantedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmsPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsDocumentLink" (
    "id" TEXT NOT NULL,
    "linkType" TEXT NOT NULL DEFAULT 'RELATED',
    "sourceDocumentId" TEXT NOT NULL,
    "targetDocumentId" TEXT NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmsDocumentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsFavorite" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmsFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsShareLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "password" TEXT,
    "expiresAt" TIMESTAMP(3),
    "maxViews" INTEGER,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "documentId" TEXT NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmsShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsComplianceTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "industry" TEXT NOT NULL,
    "retentionYears" INTEGER NOT NULL,
    "disposalAction" TEXT NOT NULL DEFAULT 'ARCHIVE',
    "legalBasis" TEXT,
    "teamId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmsComplianceTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DmsPermission_userId_locationId_level_key" ON "DmsPermission"("userId", "locationId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "DmsPermission_userId_documentId_level_key" ON "DmsPermission"("userId", "documentId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "DmsDocumentLink_sourceDocumentId_targetDocumentId_key" ON "DmsDocumentLink"("sourceDocumentId", "targetDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "DmsFavorite_userId_documentId_key" ON "DmsFavorite"("userId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "DmsShareLink_token_key" ON "DmsShareLink"("token");

-- AddForeignKey
ALTER TABLE "DmsWorkflow" ADD CONSTRAINT "DmsWorkflow_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DmsDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsWorkflow" ADD CONSTRAINT "DmsWorkflow_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsWorkflowStep" ADD CONSTRAINT "DmsWorkflowStep_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "DmsWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsWorkflowStep" ADD CONSTRAINT "DmsWorkflowStep_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsPermission" ADD CONSTRAINT "DmsPermission_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "DmsLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsPermission" ADD CONSTRAINT "DmsPermission_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DmsDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsPermission" ADD CONSTRAINT "DmsPermission_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "DmsClassification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsPermission" ADD CONSTRAINT "DmsPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsPermission" ADD CONSTRAINT "DmsPermission_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsDocumentLink" ADD CONSTRAINT "DmsDocumentLink_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "DmsDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsDocumentLink" ADD CONSTRAINT "DmsDocumentLink_targetDocumentId_fkey" FOREIGN KEY ("targetDocumentId") REFERENCES "DmsDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsDocumentLink" ADD CONSTRAINT "DmsDocumentLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsFavorite" ADD CONSTRAINT "DmsFavorite_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DmsDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsFavorite" ADD CONSTRAINT "DmsFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsShareLink" ADD CONSTRAINT "DmsShareLink_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DmsDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsShareLink" ADD CONSTRAINT "DmsShareLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsComplianceTemplate" ADD CONSTRAINT "DmsComplianceTemplate_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
