-- Per-org WorkHub AI credential (a `whk_` key with the `ai.invoke` scope).
--
-- AI is configured from the AI Credits screen rather than the environment, so
-- each organization holds its own key. That is also what gives WorkHub per-org
-- usage attribution on their side — their meter keys on the credential.
--
-- Deliberately distinct from `workhubApiKey`, which is the mailbox-read key:
-- WorkHub scopes the two independently, and reusing one column would let a
-- mailbox key silently authorize spend.
ALTER TABLE "Organization" ADD COLUMN "workhubAiApiKey" TEXT;
