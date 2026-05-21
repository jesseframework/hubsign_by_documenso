-- AlterTable: WorkHub inbox API key (x-api-key) for the inbox read API
ALTER TABLE "Organization" ADD COLUMN "workhubApiKey" TEXT;
