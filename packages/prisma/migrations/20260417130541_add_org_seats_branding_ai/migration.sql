-- CreateEnum
CREATE TYPE "OrgSeatTier" AS ENUM ('STARTER', 'PRO', 'ENTERPRISE');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "billingStatus" TEXT NOT NULL DEFAULT 'inactive',
ADD COLUMN     "brandingAccentColor" TEXT,
ADD COLUMN     "brandingButtonColor" TEXT,
ADD COLUMN     "brandingButtonHoverColor" TEXT,
ADD COLUMN     "brandingButtonTextColor" TEXT,
ADD COLUMN     "brandingLogo" TEXT,
ADD COLUMN     "brandingPrimaryColor" TEXT,
ADD COLUMN     "brandingSidebarBg" TEXT,
ADD COLUMN     "brandingSidebarTextColor" TEXT,
ADD COLUMN     "ocrApiKey" TEXT,
ADD COLUMN     "ocrApiPassword" TEXT,
ADD COLUMN     "ocrApiUrl" TEXT,
ADD COLUMN     "ocrApiUsername" TEXT,
ADD COLUMN     "ocrAutoProcess" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ocrDefaultEngine" TEXT,
ADD COLUMN     "ocrDefaultTemplateId" INTEGER,
ADD COLUMN     "seatCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeDmsPriceId" TEXT,
ADD COLUMN     "stripeSeatPriceId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT;

-- AlterTable
ALTER TABLE "OrganizationMember" ADD COLUMN     "dmsAddon" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "seatTier" "OrgSeatTier";

-- CreateTable
CREATE TABLE "OrgSeatPlan" (
    "id" TEXT NOT NULL,
    "tier" "OrgSeatTier" NOT NULL,
    "documentsPerMonth" INTEGER NOT NULL DEFAULT 20,
    "recipientsPerMonth" INTEGER NOT NULL DEFAULT 50,
    "directTemplates" INTEGER NOT NULL DEFAULT 5,
    "dmsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "assigned" INTEGER NOT NULL DEFAULT 0,
    "stripePriceId" TEXT,
    "organizationId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgSeatPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsAiConversation" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "userId" INTEGER NOT NULL,
    "organizationId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DmsAiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsAiMessage" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "conversationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmsAiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DmsAiUsage" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "totalQueries" INTEGER NOT NULL DEFAULT 0,
    "totalPromptTokens" INTEGER NOT NULL DEFAULT 0,
    "totalCompletionTokens" INTEGER NOT NULL DEFAULT 0,
    "userId" INTEGER NOT NULL,
    "organizationId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DmsAiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DmsAiUsage_userId_month_key" ON "DmsAiUsage"("userId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_stripeCustomerId_key" ON "Organization"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_stripeSubscriptionId_key" ON "Organization"("stripeSubscriptionId");

-- AddForeignKey
ALTER TABLE "OrgSeatPlan" ADD CONSTRAINT "OrgSeatPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsAiConversation" ADD CONSTRAINT "DmsAiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsAiConversation" ADD CONSTRAINT "DmsAiConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsAiMessage" ADD CONSTRAINT "DmsAiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "DmsAiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsAiUsage" ADD CONSTRAINT "DmsAiUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DmsAiUsage" ADD CONSTRAINT "DmsAiUsage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

