-- CreateEnum
CREATE TYPE "DmsDocumentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'UNDER_REVIEW', 'ARCHIVED', 'DESTROYED');

-- CreateEnum
CREATE TYPE "DmsConfidentiality" AS ENUM ('PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "DmsRetrievalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'RETRIEVED', 'RETURNED', 'OVERDUE');

-- CreateTable
CREATE TABLE "DmsLocation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "description" TEXT,
    "teamId" INTEGER,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DmsLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsCabinet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DmsCabinet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsShelf" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT,
    "cabinetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DmsShelf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsBin" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "barcode" TEXT,
    "label" TEXT,
    "shelfId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DmsBin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsDocumentType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metadataSchema" JSONB,
    "teamId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DmsDocumentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsClassification" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "parentId" TEXT,
    "teamId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DmsClassification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsTag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "teamId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmsTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsDocument" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "referenceNumber" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "ocrText" TEXT,
    "ocrProcessed" BOOLEAN NOT NULL DEFAULT false,
    "status" "DmsDocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "confidentiality" "DmsConfidentiality" NOT NULL DEFAULT 'INTERNAL',
    "metadata" JSONB,
    "retentionDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "binId" TEXT,
    "documentTypeId" TEXT,
    "classificationId" TEXT,
    "signedDocumentId" INTEGER,
    "uploadedById" INTEGER NOT NULL,
    "teamId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DmsDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsDocumentTag" (
    "documentId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "DmsDocumentTag_pkey" PRIMARY KEY ("documentId","tagId")
);

-- CreateTable
CREATE TABLE "DmsVersion" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "notes" TEXT,
    "documentId" TEXT NOT NULL,
    "uploadedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmsVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsRetrievalRequest" (
    "id" TEXT NOT NULL,
    "status" "DmsRetrievalStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "reason" TEXT,
    "dueDate" TIMESTAMP(3),
    "returnDate" TIMESTAMP(3),
    "documentId" TEXT NOT NULL,
    "requestedById" INTEGER NOT NULL,
    "approvedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DmsRetrievalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsFilingRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "condition" JSONB NOT NULL,
    "binId" TEXT,
    "documentTypeId" TEXT,
    "classificationId" TEXT,
    "teamId" INTEGER,
    "createdBy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DmsFilingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsAuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "ipAddress" TEXT,
    "documentId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmsAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsComment" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DmsComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DmsBin_barcode_key" ON "DmsBin"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "DmsTag_name_teamId_key" ON "DmsTag"("name", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "DmsDocument_referenceNumber_key" ON "DmsDocument"("referenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DmsDocument_signedDocumentId_key" ON "DmsDocument"("signedDocumentId");

-- AddForeignKey
ALTER TABLE "DmsLocation" ADD CONSTRAINT "DmsLocation_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsLocation" ADD CONSTRAINT "DmsLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsCabinet" ADD CONSTRAINT "DmsCabinet_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "DmsLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsShelf" ADD CONSTRAINT "DmsShelf_cabinetId_fkey" FOREIGN KEY ("cabinetId") REFERENCES "DmsCabinet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsBin" ADD CONSTRAINT "DmsBin_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "DmsShelf"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsDocumentType" ADD CONSTRAINT "DmsDocumentType_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsClassification" ADD CONSTRAINT "DmsClassification_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "DmsClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsClassification" ADD CONSTRAINT "DmsClassification_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsTag" ADD CONSTRAINT "DmsTag_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsDocument" ADD CONSTRAINT "DmsDocument_binId_fkey" FOREIGN KEY ("binId") REFERENCES "DmsBin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsDocument" ADD CONSTRAINT "DmsDocument_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DmsDocumentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsDocument" ADD CONSTRAINT "DmsDocument_classificationId_fkey" FOREIGN KEY ("classificationId") REFERENCES "DmsClassification"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsDocument" ADD CONSTRAINT "DmsDocument_signedDocumentId_fkey" FOREIGN KEY ("signedDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsDocument" ADD CONSTRAINT "DmsDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsDocument" ADD CONSTRAINT "DmsDocument_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsDocumentTag" ADD CONSTRAINT "DmsDocumentTag_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DmsDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsDocumentTag" ADD CONSTRAINT "DmsDocumentTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "DmsTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsVersion" ADD CONSTRAINT "DmsVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DmsDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsVersion" ADD CONSTRAINT "DmsVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsRetrievalRequest" ADD CONSTRAINT "DmsRetrievalRequest_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DmsDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsRetrievalRequest" ADD CONSTRAINT "DmsRetrievalRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsRetrievalRequest" ADD CONSTRAINT "DmsRetrievalRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsFilingRule" ADD CONSTRAINT "DmsFilingRule_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsFilingRule" ADD CONSTRAINT "DmsFilingRule_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsAuditLog" ADD CONSTRAINT "DmsAuditLog_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DmsDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsAuditLog" ADD CONSTRAINT "DmsAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsComment" ADD CONSTRAINT "DmsComment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DmsDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsComment" ADD CONSTRAINT "DmsComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
