-- CreateTable
CREATE TABLE "PushDeviceToken" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushDeviceToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushDeviceToken_token_key" ON "PushDeviceToken"("token");
CREATE INDEX "PushDeviceToken_userId_idx" ON "PushDeviceToken"("userId");

ALTER TABLE "PushDeviceToken" ADD CONSTRAINT "PushDeviceToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "PushNotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "documentSentToYou" BOOLEAN NOT NULL DEFAULT true,
    "documentSigned" BOOLEAN NOT NULL DEFAULT true,
    "documentCompleted" BOOLEAN NOT NULL DEFAULT true,
    "documentRejected" BOOLEAN NOT NULL DEFAULT true,
    "reminderReceived" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PushNotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PushNotificationPreference_userId_key" ON "PushNotificationPreference"("userId");

ALTER TABLE "PushNotificationPreference" ADD CONSTRAINT "PushNotificationPreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
