/**
 * Which WorkHub AI credential an organization's calls should use.
 *
 * The key is configured per organization from the AI Credits screen, not from
 * the environment. Two reasons that matters: WorkHub's usage attribution keys on
 * the credential, so one key per org is what makes their per-org reporting work;
 * and rotating or revoking AI access for one customer shouldn't mean editing a
 * deployment's environment and restarting the process.
 *
 * `WORKHUB_AI_API_KEY` remains as a fallback, but it is deliberately NOT the
 * configuration path. It covers the case the org setting cannot: a user on a
 * personal account with no organization at all, who can still use Aubrey on the
 * monthly free allotment. Leave it unset and those users simply have no AI.
 */
import { prisma } from '@documenso/prisma';

import { env } from '../../utils/env';
import { isAiBridgeBaseConfigured } from './bridge';

/**
 * Resolve the key for an org, falling back to the deployment key.
 *
 * Returns `null` when neither is set — the caller should treat that as "AI is
 * not configured" rather than attempting a call that will 401.
 */
export async function resolveAiApiKey(organizationId: number | null): Promise<string | null> {
  if (organizationId !== null) {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { workhubAiApiKey: true },
    });

    const orgKey = (organization?.workhubAiApiKey ?? '').trim();
    if (orgKey) return orgKey;
  }

  return (env('WORKHUB_AI_API_KEY') ?? '').trim() || null;
}

/** Whether this org can make AI calls at all. One query; safe to call in a UI gate. */
export async function isAiConfiguredForOrg(organizationId: number | null): Promise<boolean> {
  if (!isAiBridgeBaseConfigured()) return false;

  return (await resolveAiApiKey(organizationId)) !== null;
}
