-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "signReminderEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Organization" ADD COLUMN "signReminderDays" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Organization" ADD COLUMN "signReminderMaxCount" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN "remindersSent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Recipient" ADD COLUMN "lastReminderAt" TIMESTAMP(3);
