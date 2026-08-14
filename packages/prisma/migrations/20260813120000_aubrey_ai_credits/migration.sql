-- Aubrey AI credits: per-org shared purchased balance + redemption ledger.

-- CreateTable
CREATE TABLE "AiCreditBalance" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "totalPurchased" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCreditBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCreditRedemption" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" INTEGER,
    "redeemedByUserId" INTEGER,

    CONSTRAINT "AiCreditRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiCreditBalance_organizationId_key" ON "AiCreditBalance"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AiCreditRedemption_jti_key" ON "AiCreditRedemption"("jti");

-- CreateIndex
CREATE INDEX "AiCreditRedemption_organizationId_idx" ON "AiCreditRedemption"("organizationId");
