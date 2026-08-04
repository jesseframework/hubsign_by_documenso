-- CreateEnum
CREATE TYPE "MsTeamsTransport" AS ENUM ('WEBHOOK', 'BOT');


-- CreateEnum
CREATE TYPE "MsTeamsDeliveryStatus" AS ENUM ('SUCCESS', 'FAILED');


-- CreateTable
CREATE TABLE "MsTeamsConnection" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "transport" "MsTeamsTransport" NOT NULL DEFAULT 'WEBHOOK',
    "tenantId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MsTeamsConnection_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "MsTeamsChannelLink" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "conversationId" TEXT,
    "serviceUrl" TEXT,
    "msTeamId" TEXT,
    "msChannelId" TEXT,
    "events" TEXT[],
    "tracker" BOOLEAN NOT NULL DEFAULT false,
    "digest" BOOLEAN NOT NULL DEFAULT false,
    "digestCron" TEXT,
    "digestTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "digestLastRunAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MsTeamsChannelLink_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "MsTeamsCardRef" (
    "id" TEXT NOT NULL,
    "channelLinkId" TEXT NOT NULL,
    "documentId" INTEGER NOT NULL,
    "activityId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "serviceUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MsTeamsCardRef_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "MsTeamsDelivery" (
    "id" TEXT NOT NULL,
    "channelLinkId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "status" "MsTeamsDeliveryStatus" NOT NULL,
    "transport" "MsTeamsTransport" NOT NULL,
    "requestBody" JSONB NOT NULL,
    "responseCode" INTEGER,
    "responseBody" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MsTeamsDelivery_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "MsTeamsLinkRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "serviceUrl" TEXT NOT NULL,
    "msTeamId" TEXT,
    "msChannelId" TEXT,
    "channelName" TEXT,
    "promptActivityId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MsTeamsLinkRequest_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE UNIQUE INDEX "MsTeamsConnection_organizationId_key" ON "MsTeamsConnection"("organizationId");


-- CreateIndex
CREATE INDEX "MsTeamsChannelLink_connectionId_idx" ON "MsTeamsChannelLink"("connectionId");


-- CreateIndex
CREATE UNIQUE INDEX "MsTeamsChannelLink_connectionId_conversationId_key" ON "MsTeamsChannelLink"("connectionId", "conversationId");


-- CreateIndex
CREATE INDEX "MsTeamsCardRef_documentId_idx" ON "MsTeamsCardRef"("documentId");


-- CreateIndex
CREATE UNIQUE INDEX "MsTeamsCardRef_channelLinkId_documentId_key" ON "MsTeamsCardRef"("channelLinkId", "documentId");


-- CreateIndex
CREATE INDEX "MsTeamsDelivery_channelLinkId_createdAt_idx" ON "MsTeamsDelivery"("channelLinkId", "createdAt");


-- CreateIndex
CREATE INDEX "MsTeamsLinkRequest_expiresAt_idx" ON "MsTeamsLinkRequest"("expiresAt");


-- AddForeignKey
ALTER TABLE "MsTeamsChannelLink" ADD CONSTRAINT "MsTeamsChannelLink_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "MsTeamsConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "MsTeamsCardRef" ADD CONSTRAINT "MsTeamsCardRef_channelLinkId_fkey" FOREIGN KEY ("channelLinkId") REFERENCES "MsTeamsChannelLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "MsTeamsDelivery" ADD CONSTRAINT "MsTeamsDelivery_channelLinkId_fkey" FOREIGN KEY ("channelLinkId") REFERENCES "MsTeamsChannelLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

