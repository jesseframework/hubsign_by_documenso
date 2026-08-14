-- Add TEAM as a new OrgSeatTier value, alongside BUSINESS/ENTERPRISE. Purely
-- additive (no existing rows use it yet), so unlike the earlier
-- consolidate_org_seat_tiers migration this doesn't need a data remap.
ALTER TYPE "OrgSeatTier" ADD VALUE 'TEAM';
