-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "spendMeterEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "spendMeterField" TEXT,
ADD COLUMN     "spendMeterDays" INTEGER NOT NULL DEFAULT 90;
