-- CreateTable
CREATE TABLE "DocumentStampPlacement" (
    "id" TEXT NOT NULL,
    "documentId" INTEGER NOT NULL,
    "stampId" TEXT NOT NULL,
    "pageIndex" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "rotation" DOUBLE PRECISION,
    "opacity" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentStampPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentStampPlacement_documentId_idx" ON "DocumentStampPlacement"("documentId");
CREATE INDEX "DocumentStampPlacement_stampId_idx" ON "DocumentStampPlacement"("stampId");

-- AddForeignKey
ALTER TABLE "DocumentStampPlacement" ADD CONSTRAINT "DocumentStampPlacement_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentStampPlacement" ADD CONSTRAINT "DocumentStampPlacement_stampId_fkey" FOREIGN KEY ("stampId") REFERENCES "Stamp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
