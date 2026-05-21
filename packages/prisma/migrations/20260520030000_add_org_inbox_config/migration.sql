-- AlterTable: per-org signature-inbox (WorkHub receive) config
ALTER TABLE "Organization"
    ADD COLUMN "inboxEmail" TEXT,
    ADD COLUMN "workhubUsername" TEXT,
    ADD COLUMN "workhubPassword" TEXT,
    ADD COLUMN "workhubMailboxId" TEXT,
    ADD COLUMN "workhubApiBase" TEXT;
