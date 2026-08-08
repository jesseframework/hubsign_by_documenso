-- Scope eSign documents to an organization.
--
-- Until now "the org's documents" was derived from the set of member user-ids,
-- which meant a user belonging to several organizations caused each of those
-- organizations to report that user's documents as its own. This column makes
-- ownership explicit.
--
-- Nullable by design: personal accounts legitimately have no organization.
-- Null means "no org", never "any org" — queries must filter on a concrete id.

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "organizationId" INTEGER;

-- CreateIndex
CREATE INDEX "Document_organizationId_idx" ON "Document"("organizationId");

-- CreateIndex
CREATE INDEX "Document_organizationId_deletedAt_status_idx" ON "Document"("organizationId", "deletedAt", "status");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill existing rows.
--
-- Precedence mirrors `resolveOrganizationId`: the team's organization first,
-- then the author's EARLIEST membership. Earliest (not arbitrary) is what makes
-- this deterministic and matches how the rest of the codebase resolves an org.
-- Rows whose author belongs to no organization stay NULL.
UPDATE "Document" d
SET "organizationId" = COALESCE(
  (SELECT t."organizationId" FROM "Team" t WHERE t.id = d."teamId"),
  (SELECT m."organizationId"
     FROM "OrganizationMember" m
    WHERE m."userId" = d."userId"
    ORDER BY m."joinedAt" ASC
    LIMIT 1)
)
WHERE d."organizationId" IS NULL;
