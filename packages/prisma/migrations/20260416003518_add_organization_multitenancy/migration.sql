-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('ORG_ADMIN', 'DMS_ADMIN', 'TEAM_ADMIN', 'MANAGER', 'MEMBER');

-- CreateEnum
CREATE TYPE "DmsPermissionAction" AS ENUM ('DMS_VIEW', 'DMS_UPLOAD', 'DMS_DOWNLOAD', 'DMS_EDIT', 'DMS_DELETE', 'DMS_MANAGE_FILING', 'DMS_MANAGE_TYPES', 'DMS_APPROVE_WORKFLOWS', 'DMS_APPROVE_RETRIEVALS', 'DMS_MANAGE_RETENTION', 'DMS_EXPORT', 'DMS_VIEW_AUDIT_TRAIL');

-- AlterTable
ALTER TABLE "DmsClassification" ADD COLUMN     "organizationId" INTEGER;

-- AlterTable
ALTER TABLE "DmsComplianceTemplate" ADD COLUMN     "organizationId" INTEGER;

-- AlterTable
ALTER TABLE "DmsDocument" ADD COLUMN     "organizationId" INTEGER;

-- AlterTable
ALTER TABLE "DmsDocumentType" ADD COLUMN     "organizationId" INTEGER;

-- AlterTable
ALTER TABLE "DmsFilingRule" ADD COLUMN     "organizationId" INTEGER;

-- AlterTable
ALTER TABLE "DmsLocation" ADD COLUMN     "organizationId" INTEGER;

-- AlterTable
ALTER TABLE "DmsTag" ADD COLUMN     "organizationId" INTEGER;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "organizationId" INTEGER;

-- CreateTable
CREATE TABLE "Organization" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT,
    "logoUrl" TEXT,
    "defaultConfidentiality" "DmsConfidentiality" NOT NULL DEFAULT 'INTERNAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL DEFAULT 'MEMBER',
    "organizationId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsOrgPermission" (
    "id" TEXT NOT NULL,
    "action" "DmsPermissionAction" NOT NULL,
    "memberId" TEXT NOT NULL,
    "locationId" TEXT,
    "classificationId" TEXT,
    "grantedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmsOrgPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsRecycleBinItem" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "deletedById" INTEGER NOT NULL,
    "organizationId" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmsRecycleBinItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsSavedSearch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "userId" INTEGER NOT NULL,
    "organizationId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DmsSavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_domain_key" ON "Organization"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "DmsRecycleBinItem_documentId_key" ON "DmsRecycleBinItem"("documentId");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsLocation" ADD CONSTRAINT "DmsLocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsDocumentType" ADD CONSTRAINT "DmsDocumentType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsClassification" ADD CONSTRAINT "DmsClassification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsTag" ADD CONSTRAINT "DmsTag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsDocument" ADD CONSTRAINT "DmsDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsFilingRule" ADD CONSTRAINT "DmsFilingRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsComplianceTemplate" ADD CONSTRAINT "DmsComplianceTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsOrgPermission" ADD CONSTRAINT "DmsOrgPermission_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "OrganizationMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsOrgPermission" ADD CONSTRAINT "DmsOrgPermission_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsRecycleBinItem" ADD CONSTRAINT "DmsRecycleBinItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DmsDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsRecycleBinItem" ADD CONSTRAINT "DmsRecycleBinItem_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsRecycleBinItem" ADD CONSTRAINT "DmsRecycleBinItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsSavedSearch" ADD CONSTRAINT "DmsSavedSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsSavedSearch" ADD CONSTRAINT "DmsSavedSearch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
