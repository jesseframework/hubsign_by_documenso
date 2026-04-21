-- AlterTable
ALTER TABLE "Document" ADD COLUMN "pdfPassword" TEXT;
ALTER TABLE "Document" ADD COLUMN "pdfLocked" BOOLEAN NOT NULL DEFAULT false;
