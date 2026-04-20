-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "allowedEmailDomains" TEXT[] DEFAULT ARRAY[]::TEXT[];
