-- CreateEnum
CREATE TYPE "DmsDocumentFormat" AS ENUM ('DIGITAL', 'PHYSICAL', 'BOTH');

-- CreateEnum
CREATE TYPE "DmsDisposalStatus" AS ENUM ('NOT_DUE', 'DUE_FOR_REVIEW', 'APPROVED_FOR_DISPOSAL', 'DISPOSED', 'RETAINED');

-- AlterTable
ALTER TABLE "DmsDocument" ADD COLUMN     "disposalApprovedById" INTEGER,
ADD COLUMN     "disposalDate" TIMESTAMP(3),
ADD COLUMN     "disposalNotes" TEXT,
ADD COLUMN     "disposalStatus" "DmsDisposalStatus" NOT NULL DEFAULT 'NOT_DUE',
ADD COLUMN     "format" "DmsDocumentFormat" NOT NULL DEFAULT 'DIGITAL',
ADD COLUMN     "labelPrinted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "physicalLocation" TEXT;
