-- HubSign license-key activation (WorkHub-minted keys redeemed via the WorkHub API).
-- OrgSeatPlan + Subscription gain a `source` discriminator + expiry; a local
-- redemption ledger records what was redeemed (WorkHub enforces global single-use).

-- OrgSeatPlan: org (seat-plan) license grants
ALTER TABLE "OrgSeatPlan" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'stripe';
ALTER TABLE "OrgSeatPlan" ADD COLUMN "expiresAt" TIMESTAMP(3);

-- Subscription: individual license grants (quota derived from licenseTier, not Stripe)
ALTER TABLE "Subscription" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'stripe';
ALTER TABLE "Subscription" ADD COLUMN "licenseTier" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "licenseAddons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Local redemption ledger
CREATE TABLE "LicenseKeyRedemption" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "grantType" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "addons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "seats" INTEGER,
    "days" INTEGER NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "organizationId" INTEGER,
    "userId" INTEGER,
    "redeemedByUserId" INTEGER,
    CONSTRAINT "LicenseKeyRedemption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LicenseKeyRedemption_jti_key" ON "LicenseKeyRedemption"("jti");
CREATE INDEX "LicenseKeyRedemption_organizationId_idx" ON "LicenseKeyRedemption"("organizationId");
CREATE INDEX "LicenseKeyRedemption_userId_idx" ON "LicenseKeyRedemption"("userId");
