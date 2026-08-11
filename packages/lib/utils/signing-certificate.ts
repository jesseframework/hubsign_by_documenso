/**
 * Whether a document's sealed PDF should carry the Final Audit Report page.
 *
 * WHY THIS IS SHARED. There are two seal implementations — the job handler
 * (`jobs/definitions/internal/seal-document.handler.ts`, the path every normal
 * completion takes) and `server-only/document/seal-document.ts` (admin reseal).
 * They have already drifted once: only the second recorded
 * `Document.certificatePageCount`, which left every normally-completed document
 * claiming zero certificate pages and silently disabled the whole
 * "download without the certificate" feature. Keeping the *policy* in one place
 * means the next change can't apply to one path and not the other.
 *
 * PRECEDENCE: team, then organization, then on.
 *
 * A team setting wins where one exists because it is the narrower scope. `null`
 * and `undefined` both mean "not configured" and fall through — a team that has
 * never opened its settings must not read as an explicit "off". Defaulting to
 * true preserves the historical behaviour: the certificate is the audit trail,
 * so it is present unless somebody deliberately turned it off.
 */
export const shouldIncludeSigningCertificate = ({
  teamSetting,
  organizationSetting,
}: {
  teamSetting?: boolean | null;
  organizationSetting?: boolean | null;
}): boolean => teamSetting ?? organizationSetting ?? true;
