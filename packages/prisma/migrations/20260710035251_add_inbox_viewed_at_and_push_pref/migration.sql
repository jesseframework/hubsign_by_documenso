-- AlterTable
ALTER TABLE "PushNotificationPreference" ADD COLUMN     "inboxItemReceived" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "SignatureInboxItem" ADD COLUMN     "viewedAt" TIMESTAMP(3);

-- Backfill: treat every pre-existing item as already viewed (using its last
-- update time) so the historical backlog doesn't all surface as "unread" the
-- moment this ships — only genuinely new items should land unread.
UPDATE "SignatureInboxItem" SET "viewedAt" = "updatedAt" WHERE "viewedAt" IS NULL;
