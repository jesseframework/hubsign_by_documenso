-- Stamps are now scoped to an Organization (not user / not team). Drop any
-- existing stamps since user/team-scoped rows are no longer reachable; the
-- product was launched today so there's no real customer data to preserve.
DELETE FROM "DocumentStampPlacement";
DELETE FROM "Stamp";

-- DropForeignKey
ALTER TABLE "Stamp" DROP CONSTRAINT IF EXISTS "Stamp_userId_fkey";
ALTER TABLE "Stamp" DROP CONSTRAINT IF EXISTS "Stamp_teamId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "Stamp_userId_idx";
DROP INDEX IF EXISTS "Stamp_teamId_idx";

-- AlterTable
ALTER TABLE "Stamp" DROP COLUMN "userId";
ALTER TABLE "Stamp" DROP COLUMN "teamId";
ALTER TABLE "Stamp" ADD COLUMN "organizationId" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "Stamp_organizationId_idx" ON "Stamp"("organizationId");

-- AddForeignKey
ALTER TABLE "Stamp" ADD CONSTRAINT "Stamp_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
