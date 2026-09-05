-- Realtime inbound mail via WorkHub's `email.mail-received` webhook (Svix).
--
-- Replaces most of the 2-minute inbox poll. The watch id comes from WorkHub's
-- registration call; the signing secret has to be copied out of the Svix portal
-- by a human, so both are stored per organization rather than derived.
--
-- Nullable and unset by default: the feature stays dark until an admin registers,
-- and the timed poll keeps running as a backstop regardless.
ALTER TABLE "Organization" ADD COLUMN "workhubWebhookId" TEXT;
ALTER TABLE "Organization" ADD COLUMN "workhubWebhookSecret" TEXT;
