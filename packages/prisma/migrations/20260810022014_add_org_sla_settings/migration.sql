-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "slaDefaultEndToEndHours" INTEGER,
ADD COLUMN     "slaDefaultInternalHours" INTEGER,
ADD COLUMN     "slaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "slaHolidays" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "slaTimezone" TEXT,
ADD COLUMN     "slaWorkdayEnd" TEXT,
ADD COLUMN     "slaWorkdayStart" TEXT,
ADD COLUMN     "slaWorkingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[];
