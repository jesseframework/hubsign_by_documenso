-- CreateTable
CREATE TABLE "DocumentSupportingFile" (
    "id" TEXT NOT NULL,
    "documentId" INTEGER NOT NULL,
    "recipientId" INTEGER,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "type" "DocumentDataType" NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentSupportingFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentSupportingFile_documentId_idx" ON "DocumentSupportingFile"("documentId");

-- CreateIndex
CREATE INDEX "DocumentSupportingFile_recipientId_idx" ON "DocumentSupportingFile"("recipientId");

-- AddForeignKey
ALTER TABLE "DocumentSupportingFile" ADD CONSTRAINT "DocumentSupportingFile_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSupportingFile" ADD CONSTRAINT "DocumentSupportingFile_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

