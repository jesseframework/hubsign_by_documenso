-- CreateEnum
CREATE TYPE "DocumentAnnotationType" AS ENUM ('HIGHLIGHT', 'DRAW', 'NOTE');

-- CreateTable
CREATE TABLE "DocumentAnnotation" (
    "id" TEXT NOT NULL,
    "documentId" INTEGER NOT NULL,
    "pageIndex" INTEGER NOT NULL,
    "type" "DocumentAnnotationType" NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "path" JSONB,
    "text" TEXT,
    "color" TEXT NOT NULL DEFAULT '#FACC15',
    "opacity" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "strokeWidth" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "fontSize" DOUBLE PRECISION,
    "createdByUserId" INTEGER,
    "createdByRecipientId" INTEGER,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentAnnotation_documentId_idx" ON "DocumentAnnotation"("documentId");

-- CreateIndex
CREATE INDEX "DocumentAnnotation_documentId_pageIndex_idx" ON "DocumentAnnotation"("documentId", "pageIndex");

-- CreateIndex
CREATE INDEX "DocumentAnnotation_createdByUserId_idx" ON "DocumentAnnotation"("createdByUserId");

-- CreateIndex
CREATE INDEX "DocumentAnnotation_createdByRecipientId_idx" ON "DocumentAnnotation"("createdByRecipientId");

-- AddForeignKey
ALTER TABLE "DocumentAnnotation" ADD CONSTRAINT "DocumentAnnotation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAnnotation" ADD CONSTRAINT "DocumentAnnotation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAnnotation" ADD CONSTRAINT "DocumentAnnotation_createdByRecipientId_fkey" FOREIGN KEY ("createdByRecipientId") REFERENCES "Recipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
