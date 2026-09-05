/**
 * Aubrey AI credit accounting.
 *
 * Two independent pools, checked in order:
 *   1. Monthly free allotment — per USER, tracked in DmsAiUsage.totalQueries
 *      against a monthly limit (env NEXT_PRIVATE_AUBREY_FREE_CREDITS_PER_MONTH,
 *      default 20; an allowlist or "unlimited" makes it uncapped).
 *   2. Purchased pool — per ORG, a shared balance in AiCreditBalance.balance,
 *      topped up by redeeming a WorkHub credit-pack key (see redeem-ai-credits).
 *
 * 1 credit = 1 message. A message draws from the monthly allotment first; once
 * that is exhausted it draws from the org's purchased pool. When both are empty
 * the message is refused and the UI prompts an ORG_ADMIN to redeem a pack.
 *
 * This deliberately reuses the existing DmsAiUsage table for the monthly meter
 * so historical usage carries over — the AI agent is being rebranded, not reset.
 */
import { prisma } from '@documenso/prisma';

import { env } from '../../utils/env';

const monthKey = (): string => new Date().toISOString().substring(0, 7); // YYYY-MM

const isUnlimitedAccount = (user?: { id?: number; email?: string | null }): boolean => {
  if (!user) return false;
  const list = (env('NEXT_PRIVATE_AUBREY_UNLIMITED_USERS') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!list.length) return false;
  const email = user.email?.toLowerCase();
  const id = user.id != null ? String(user.id) : undefined;
  return Boolean((email && list.includes(email)) || (id && list.includes(id)));
};

/**
 * Monthly free-message allotment for a user. `null` = UNLIMITED (allowlisted, or
 * env is "unlimited"/"0"/"-1"). Unset env defaults to 20.
 */
export const getAubreyMonthlyLimit = (user?: { id?: number; email?: string | null }): number | null => {
  if (isUnlimitedAccount(user)) return null;
  const raw = (env('NEXT_PRIVATE_AUBREY_FREE_CREDITS_PER_MONTH') ?? '').trim();
  if (raw === '') return 20;
  if (/^(unlimited|0|-1)$/i.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 20;
};

export type AubreyCreditSnapshot = {
  /** Monthly free allotment (null = unlimited). */
  monthlyLimit: number | null;
  monthlyUsed: number;
  /** Remaining in the monthly allotment (null = unlimited). */
  monthlyRemaining: number | null;
  /** Shared org purchased pool (0 when the user has no org). */
  purchasedBalance: number;
  /** Total messages the user can still send (null = unlimited). */
  totalRemaining: number | null;
  /** Whether the next message is allowed right now. */
  allowed: boolean;
  tokensUsed: number;
};

export type CreditScope = {
  userId: number;
  organizationId?: number | null;
  email?: string | null;
};

async function readMonthly(userId: number, email?: string | null) {
  const month = monthKey();
  const usage = await prisma.dmsAiUsage.findUnique({
    where: { userId_month: { userId, month } },
  });
  const monthlyLimit = getAubreyMonthlyLimit({ id: userId, email });
  const monthlyUsed = usage?.totalQueries ?? 0;
  const monthlyRemaining = monthlyLimit === null ? null : Math.max(monthlyLimit - monthlyUsed, 0);
  const tokensUsed = (usage?.totalPromptTokens ?? 0) + (usage?.totalCompletionTokens ?? 0);
  return { monthlyLimit, monthlyUsed, monthlyRemaining, tokensUsed };
}

async function readPurchased(organizationId?: number | null): Promise<number> {
  if (!organizationId) return 0;
  const row = await prisma.aiCreditBalance.findUnique({ where: { organizationId } });
  return row?.balance ?? 0;
}

/** Read the current credit picture without consuming anything. */
export async function getAubreyCredit(scope: CreditScope): Promise<AubreyCreditSnapshot> {
  const [monthly, purchasedBalance] = await Promise.all([
    readMonthly(scope.userId, scope.email),
    readPurchased(scope.organizationId),
  ]);

  const totalRemaining =
    monthly.monthlyRemaining === null ? null : monthly.monthlyRemaining + purchasedBalance;
  const allowed =
    monthly.monthlyRemaining === null || monthly.monthlyRemaining > 0 || purchasedBalance > 0;

  return {
    monthlyLimit: monthly.monthlyLimit,
    monthlyUsed: monthly.monthlyUsed,
    monthlyRemaining: monthly.monthlyRemaining,
    purchasedBalance,
    totalRemaining,
    allowed,
    tokensUsed: monthly.tokensUsed,
  };
}

/**
 * Charge one message. Draws from the monthly allotment first, then the org's
 * purchased pool. Token counters are always recorded. Returns the post-charge
 * snapshot. Callers should have already verified `allowed` (via getAubreyCredit
 * or by catching the thrown error).
 */
export async function consumeAubreyCredit(
  scope: CreditScope,
  tokens: { prompt: number; completion: number },
): Promise<AubreyCreditSnapshot> {
  const month = monthKey();

  // Ensure a usage row exists for token accounting.
  await prisma.dmsAiUsage.upsert({
    where: { userId_month: { userId: scope.userId, month } },
    create: { userId: scope.userId, month, organizationId: scope.organizationId ?? undefined },
    update: {},
  });

  const before = await getAubreyCredit(scope);

  if (!before.allowed) {
    throw new AubreyCreditError('No Aubrey AI credits remaining.', 'no_credits');
  }

  const drawFromMonthly = before.monthlyLimit === null || (before.monthlyRemaining ?? 0) > 0;

  await prisma.$transaction(async (tx) => {
    // Always record token usage on the monthly row.
    await tx.dmsAiUsage.update({
      where: { userId_month: { userId: scope.userId, month } },
      data: {
        totalPromptTokens: { increment: tokens.prompt },
        totalCompletionTokens: { increment: tokens.completion },
        // A monthly-funded message counts against the monthly allotment.
        ...(drawFromMonthly ? { totalQueries: { increment: 1 } } : {}),
      },
    });

    // A purchased-funded message decrements the shared org pool.
    if (!drawFromMonthly && scope.organizationId) {
      await tx.aiCreditBalance.update({
        where: { organizationId: scope.organizationId },
        data: { balance: { decrement: 1 } },
      });
    }
  });

  return getAubreyCredit(scope);
}

export class AubreyCreditError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'AubreyCreditError';
  }
}
