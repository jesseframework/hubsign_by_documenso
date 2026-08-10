-- Reminder history + saved export templates.
--
-- Two independent additions that ship together because they arrived with the
-- same feature (the Signature Inbox responsibility column and its export).

-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('AUTOMATIC', 'MANUAL');

-- CreateTable
CREATE TABLE "RecipientReminder" (
    "id" TEXT NOT NULL,
    "recipientId" INTEGER NOT NULL,
    "documentId" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" "ReminderKind" NOT NULL,
    "sentByUserId" INTEGER,

    CONSTRAINT "RecipientReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecipientReminder_recipientId_sentAt_idx" ON "RecipientReminder"("recipientId", "sentAt");

-- CreateIndex
CREATE INDEX "RecipientReminder_documentId_idx" ON "RecipientReminder"("documentId");

-- AddForeignKey
ALTER TABLE "RecipientReminder" ADD CONSTRAINT "RecipientReminder_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Recipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecipientReminder" ADD CONSTRAINT "RecipientReminder_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill what can honestly be recovered.
--
-- `Recipient.lastReminderAt` is overwritten on every send, so exactly one real
-- timestamp survives per recipient no matter how many reminders went out. We
-- insert that one and no more. A recipient with remindersSent = 2 therefore
-- ends up with one history row, and the UI derives "1 earlier send has no
-- recorded time" from the gap between the counter and the row count — which is
-- the truth, rather than two invented dates.
--
-- The id is derived from the recipient id so re-running this statement cannot
-- create a second copy of the same backfilled row.
INSERT INTO "RecipientReminder" ("id", "recipientId", "documentId", "sentAt", "kind", "sentByUserId")
SELECT
    'bfill_' || md5("Recipient"."id"::text),
    "Recipient"."id",
    "Recipient"."documentId",
    "Recipient"."lastReminderAt",
    'AUTOMATIC'::"ReminderKind",
    NULL
FROM "Recipient"
WHERE "Recipient"."lastReminderAt" IS NOT NULL
  AND "Recipient"."documentId" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

-- CreateTable
CREATE TABLE "ExportTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "datasetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "config" JSONB NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExportTemplate_organizationId_datasetId_idx" ON "ExportTemplate"("organizationId", "datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "ExportTemplate_organizationId_datasetId_name_key" ON "ExportTemplate"("organizationId", "datasetId", "name");

-- AddForeignKey
ALTER TABLE "ExportTemplate" ADD CONSTRAINT "ExportTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportTemplate" ADD CONSTRAINT "ExportTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
