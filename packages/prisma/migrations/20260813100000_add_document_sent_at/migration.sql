-- Signature-request quota (see limits/server.ts) needs to count documents
-- that were actually sent, not merely created — a saved draft shouldn't
-- burn a unit. `sentAt` is set once, in `sendDocument`, the first time a
-- document leaves DRAFT; existing documents backfill to NULL, which is
-- correct (nothing retroactively "becomes sent").
ALTER TABLE "Document" ADD COLUMN "sentAt" TIMESTAMP(3);

CREATE INDEX "Document_userId_sentAt_idx" ON "Document"("userId", "sentAt");
