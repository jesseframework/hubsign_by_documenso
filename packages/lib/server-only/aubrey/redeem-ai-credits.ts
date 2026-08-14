/**
 * Redeem a WorkHub-minted AI-credit pack and top up the org's shared Aubrey
 * pool. Mirrors the license-key flow: guard → POST the key to WorkHub (which
 * verifies signature + single-use + pinned subject) → apply the returned credit
 * amount to the org balance inside a transaction, with a local ledger row for
 * audit + idempotency.
 *
 * Product decisions:
 *   • Credits are a per-ORG shared pool; only an ORG_ADMIN may redeem a pack.
 *   • The pool is additive — packs stack on top of whatever is left.
 *   • jti is @unique in the ledger, so a double-submit is a no-op locally
 *     (WorkHub is the global single-use authority).
 */
import { OrganizationRole } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import {
  redeemWorkHubCreditKey,
  WorkHubCreditError,
  type WorkHubCreditGrant,
} from './workhub-credits-client';

export class AiCreditRedeemError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'AiCreditRedeemError';
  }
}

function mapWorkHubError(err: unknown): AiCreditRedeemError {
  if (err instanceof WorkHubCreditError) {
    const friendly: Record<string, string> = {
      invalid_key: 'That credit key is not valid.',
      subject_mismatch: 'That key was issued for a different organization.',
      already_redeemed: 'That credit key has already been used.',
      revoked: 'That credit key has been revoked.',
      unknown_key: 'That credit key is not recognised.',
      not_configured: 'AI credit redemption is not configured on this deployment.',
      unreachable: 'Could not reach the credit service. Please try again.',
      bad_response: 'The credit service returned an unexpected response. Please try again.',
    };
    return new AiCreditRedeemError(friendly[err.code] ?? err.message, err.code);
  }
  return new AiCreditRedeemError('AI credit redemption failed.', 'unknown');
}

export type RedeemAiCreditsOptions = {
  key: string;
  userId: number;
  organizationId: number;
};

export type RedeemAiCreditsResult = {
  grant: WorkHubCreditGrant;
  /** Org pool balance after applying the pack. */
  balance: number;
  /** Whether this redemption was newly applied (false = idempotent replay). */
  applied: boolean;
};

export async function redeemAiCredits(opts: RedeemAiCreditsOptions): Promise<RedeemAiCreditsResult> {
  // Authorization — only an org admin may redeem a credit pack for the org.
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: opts.organizationId, userId: opts.userId } },
  });
  if (!membership) {
    throw new AiCreditRedeemError('You are not a member of this organization.', 'not_member');
  }
  if (membership.role !== OrganizationRole.ORG_ADMIN) {
    throw new AiCreditRedeemError('Only an organization admin can redeem AI credits.', 'not_admin');
  }

  let grant: WorkHubCreditGrant;
  try {
    grant = await redeemWorkHubCreditKey(opts.key, String(opts.organizationId));
  } catch (err) {
    throw mapWorkHubError(err);
  }

  const result = await prisma.$transaction(async (tx) => {
    // Idempotency: if we've already recorded this jti, do not top up again.
    const existing = await tx.aiCreditRedemption.findUnique({ where: { jti: grant.jti } });
    if (existing) {
      const bal = await tx.aiCreditBalance.findUnique({
        where: { organizationId: opts.organizationId },
      });
      return { balance: bal?.balance ?? 0, applied: false };
    }

    const balance = await tx.aiCreditBalance.upsert({
      where: { organizationId: opts.organizationId },
      create: {
        organizationId: opts.organizationId,
        balance: grant.credits,
        totalPurchased: grant.credits,
      },
      update: {
        balance: { increment: grant.credits },
        totalPurchased: { increment: grant.credits },
      },
    });

    await tx.aiCreditRedemption.create({
      data: {
        jti: grant.jti,
        subject: String(opts.organizationId),
        credits: grant.credits,
        organizationId: opts.organizationId,
        redeemedByUserId: opts.userId,
      },
    });

    return { balance: balance.balance, applied: true };
  });

  return { grant, balance: result.balance, applied: result.applied };
}
