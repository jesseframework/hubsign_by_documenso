import { BusinessRuleOverrideStatus } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import { RULE_OVERRIDE_ENTITY_TYPE } from '../../constants/rule-overrides';
import { AppError, AppErrorCode } from '../../errors/app-error';

/**
 * Requesting and granting exceptions to a blocking business rule.
 *
 * A BLOCK is a dead end by design, and until now it was a dead end with no exit:
 * the signer cannot edit the invoice, so they closed the tab and the document sat
 * unsigned with nobody in the organization aware there was a problem. This is the
 * way out, and it is deliberately not a bypass — the signer can only ASK, and
 * only rules that were actually blocking them can be waived.
 *
 * The entity type an override's approval chain runs under lives in
 * `constants/rule-overrides` so the template editor can offer it without pulling
 * this module — and therefore Prisma — into the browser bundle. An organization
 * gets a multi-step chain by creating a template with that entityType;
 * `findApprovalTemplate` already selects on it. With no such template the request
 * waits on the document owner instead.
 */
export { RULE_OVERRIDE_ENTITY_TYPE };

/**
 * Rule ids waived for this document by an approved override.
 *
 * Consulted on every signing attempt rather than consumed, because a grant lasts
 * until the document completes: a signer who reloads, or who trips a second
 * unrelated check after being approved, must not need a fresh approval.
 */
export const waivedRuleIdsForDocument = async (documentId: number): Promise<Set<string>> => {
  const overrides = await prisma.businessRuleOverride.findMany({
    where: { documentId, status: BusinessRuleOverrideStatus.APPROVED },
    select: { rules: { select: { ruleId: true } } },
  });

  const ids = new Set<string>();

  for (const override of overrides) {
    for (const { ruleId } of override.rules) {
      // Null once the rule itself is deleted. Nothing left to waive, so the
      // waiver simply stops matching.
      if (ruleId) ids.add(ruleId);
    }
  }

  return ids;
};

/**
 * Record a signer's request to be let past the rules currently blocking them.
 *
 * The blocking rules are passed in by the caller, which has just evaluated the
 * gate: re-evaluating here would be a second source of truth and could capture a
 * different set than the one the signer was actually shown.
 */
export const requestRuleOverride = async ({
  documentId,
  organizationId,
  recipientId,
  reason,
  blocks,
}: {
  documentId: number;
  organizationId: number;
  recipientId: number;
  reason?: string | null;
  blocks: Array<{ ruleId: string; name: string; message: string }>;
}) => {
  if (blocks.length === 0) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Nothing is blocking this document, so there is nothing to override.',
      userMessage: 'Nothing is blocking this document any more — try signing again.',
    });
  }

  // One open request at a time, per document. Two signers hitting the same block
  // should not put two identical decisions in front of the same approver.
  const existing = await prisma.businessRuleOverride.findFirst({
    where: {
      documentId,
      status: { in: [BusinessRuleOverrideStatus.PENDING, BusinessRuleOverrideStatus.APPROVED] },
    },
    select: { id: true, status: true },
  });

  if (existing) {
    return { ...existing, alreadyExisted: true as const };
  }

  const override = await prisma.businessRuleOverride.create({
    data: {
      documentId,
      organizationId,
      requestedByRecipientId: recipientId,
      reason: reason?.trim() ? reason.trim() : null,
      blockedReason: blocks.map((b) => b.message).join('\n'),
      rules: {
        create: blocks.map((b) => ({ ruleId: b.ruleId, ruleName: b.name })),
      },
    },
    select: { id: true, status: true },
  });

  /*
    Try to route it through an approval chain. `startApprovalRequest` answers
    `skipped: no-template` when the organization has not configured one, which is
    not a failure: the request then waits on the document owner, who decides it
    from the document page. Either way the override row is the source of truth,
    so a chain that cannot start does not lose the request.
  */
  /*
    Imported here rather than at the top for two reasons: the approval engine
    imports this module back (to record a chain's decision), and the signing gate
    imports this one — a static edge would both cycle and pull the whole approval
    machinery onto the path of every signature.
  */
  const { startApprovalRequest } = await import('../approval/approval-execution');

  const started = await startApprovalRequest({
    organizationId,
    entityType: RULE_OVERRIDE_ENTITY_TYPE,
    entityId: override.id,
    cancelExisting: false,
  }).catch((err) => {
    console.error('[rule-override] could not start an approval chain:', err);

    return { skipped: true as const, reason: 'error' };
  });

  if ('requestId' in started) {
    await prisma.businessRuleOverride.update({
      where: { id: override.id },
      data: { approvalRequestId: started.requestId },
    });

    return { ...override, alreadyExisted: false as const, routedToChain: true as const };
  }

  /*
    No chain, so this waits on the document owner — who has to be told, or the
    request sits in a queue nobody has a reason to open and the signer is no
    better off than before there was a request at all.

    Never allowed to fail the request: the row is already written and is what the
    queue reads, so a mail problem must not lose the signer's ask.
  */
  await notifyOwnerOfOverrideRequest({ documentId, blocks, reason }).catch((err) =>
    console.error('[rule-override] could not notify the document owner:', err),
  );

  return { ...override, alreadyExisted: false as const, routedToChain: false as const };
};

const notifyOwnerOfOverrideRequest = async ({
  documentId,
  blocks,
  reason,
}: {
  documentId: number;
  blocks: Array<{ name: string; message: string }>;
  reason?: string | null;
}) => {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, title: true, user: { select: { name: true, email: true } } },
  });

  if (!document?.user?.email) return;

  const { mailer } = await import('@documenso/email/mailer');
  const { FROM_ADDRESS, FROM_NAME } = await import('../../constants/email');
  const { NEXT_PUBLIC_WEBAPP_URL } = await import('../../constants/app');

  const url = `${NEXT_PUBLIC_WEBAPP_URL()}/org/business-rules`;
  const blocked = blocks.map((b) => `<li>${b.message}</li>`).join('');

  await mailer.sendMail({
    to: { name: document.user.name ?? '', address: document.user.email },
    from: { name: FROM_NAME, address: FROM_ADDRESS },
    subject: `Signer blocked on "${document.title}" — they are asking for an exception`,
    html: `
      <div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:560px;margin:0 auto;color:#111">
        <h2 style="font-size:18px;margin:0 0 12px">A signer cannot sign "${document.title}"</h2>
        <p>A business rule stopped them and they cannot fix it themselves, so they have asked you to approve an exception.</p>
        <p style="margin:0 0 4px;color:#666;font-size:13px">What blocked them:</p>
        <ul style="font-size:13px;margin:0 0 12px">${blocked}</ul>
        ${reason ? `<p style="font-size:13px;color:#666">Their reason: ${reason}</p>` : ''}
        <p style="margin:24px 0">
          <a href="${url}" style="background:#7c5cfc;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;font-weight:600">Review the request</a>
        </p>
        <p style="font-size:12px;color:#888">Approving waives only the rules listed above, and only for this document.</p>
      </div>`,
    text:
      `A signer cannot sign "${document.title}" and is asking for an exception.\n\n` +
      `What blocked them:\n${blocks.map((b) => `- ${b.message}`).join('\n')}\n` +
      (reason ? `\nTheir reason: ${reason}\n` : '') +
      `\nReview it: ${url}`,
  });
};

/**
 * Approve or decline an override.
 *
 * Used both by an org member deciding directly and by the approval chain when its
 * final step completes, so a grant is written in exactly one place regardless of
 * how the decision was reached.
 */
export const decideRuleOverride = async ({
  overrideId,
  approved,
  decidedByUserId,
  note,
}: {
  overrideId: string;
  approved: boolean;
  decidedByUserId?: number | null;
  note?: string | null;
}) => {
  const override = await prisma.businessRuleOverride.findUnique({
    where: { id: overrideId },
    select: { id: true, status: true },
  });

  if (!override) {
    throw new AppError(AppErrorCode.NOT_FOUND, { message: 'Override request not found.' });
  }

  // Idempotent: the chain and a person can both arrive at the same row, and a
  // second decision must not overwrite the first one's author or timestamp.
  if (override.status !== BusinessRuleOverrideStatus.PENDING) {
    return override;
  }

  return prisma.businessRuleOverride.update({
    where: { id: overrideId },
    data: {
      status: approved ? BusinessRuleOverrideStatus.APPROVED : BusinessRuleOverrideStatus.REJECTED,
      decidedById: decidedByUserId ?? null,
      decidedAt: new Date(),
      decisionNote: note?.trim() ? note.trim() : null,
    },
    select: { id: true, status: true, documentId: true },
  });
};
