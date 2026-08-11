-- Org-level control over the Final Audit Report page appended at seal time.
--
-- The equivalent setting already existed on TeamGlobalSettings, but documents in
-- this deployment belong to an organization and carry no teamId, so that setting
-- was unreachable and the certificate could never be turned off. Defaults to
-- true to preserve existing behaviour.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "includeSigningCertificate" BOOLEAN NOT NULL DEFAULT true;
