-- Consolidate OrgSeatTier from 3 values (STARTER, PRO, ENTERPRISE) to 2
-- (BUSINESS, ENTERPRISE). Existing STARTER/PRO rows become BUSINESS; ENTERPRISE
-- rows and NULL seatTier are preserved as-is. Written by hand (not
-- `prisma migrate dev`, which refuses to auto-generate a migration that could
-- drop enum values still referenced by data) so the data remap happens before
-- the old enum values are dropped.

CREATE TYPE "OrgSeatTier_new" AS ENUM ('BUSINESS', 'ENTERPRISE');

ALTER TABLE "OrgSeatPlan"
  ALTER COLUMN "tier" TYPE "OrgSeatTier_new"
  USING (
    CASE "tier"::text
      WHEN 'ENTERPRISE' THEN 'ENTERPRISE'
      ELSE 'BUSINESS'
    END
  )::"OrgSeatTier_new";

ALTER TABLE "OrganizationMember"
  ALTER COLUMN "seatTier" TYPE "OrgSeatTier_new"
  USING (
    CASE
      WHEN "seatTier" IS NULL THEN NULL
      WHEN "seatTier"::text = 'ENTERPRISE' THEN 'ENTERPRISE'
      ELSE 'BUSINESS'
    END
  )::"OrgSeatTier_new";

DROP TYPE "OrgSeatTier";
ALTER TYPE "OrgSeatTier_new" RENAME TO "OrgSeatTier";
