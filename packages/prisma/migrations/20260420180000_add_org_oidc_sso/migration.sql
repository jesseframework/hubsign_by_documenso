-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "oidcEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN "oidcClientId" TEXT;
ALTER TABLE "Organization" ADD COLUMN "oidcClientSecret" TEXT;
ALTER TABLE "Organization" ADD COLUMN "oidcWellKnownUrl" TEXT;
ALTER TABLE "Organization" ADD COLUMN "oidcProviderLabel" TEXT;
ALTER TABLE "Organization" ADD COLUMN "disableSelfSignup" BOOLEAN NOT NULL DEFAULT false;
