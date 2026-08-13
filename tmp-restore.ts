import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

/**
 * Restores the override record for document 80 that my verification script
 * deleted.
 *
 * Every value below is evidenced, not guessed:
 *   • timestamps — read from the timeline output before the deletion
 *   • recipient 47 (John) — the only recipient on document 80
 *   • rule id/name — the rule named in that timeline row, still present
 *   • blockedReason — that rule's own `message`, which is verbatim what
 *     describeBlocks would have produced for a single blocking rule
 *
 * Two things are NOT recoverable and are deliberately left empty rather than
 * invented: the reason John typed, and the id of the approval request. The note
 * records that, so the row cannot be mistaken for an untouched original.
 */
const main = async () => {
  if ((await p.businessRuleOverride.count({ where: { documentId: 80 } })) > 0) {
    console.log('an override for document 80 already exists — not touching it');
    return;
  }

  const created = await p.businessRuleOverride.create({
    data: {
      documentId: 80,
      organizationId: 1,
      status: 'APPROVED',
      requestedByRecipientId: 47,
      reason: null,
      blockedReason:
        'The total on the attached purchase order differs from the invoice total by more than the allowed tolerance.',
      createdAt: new Date('2026-08-11T22:47:26.482Z'),
      decidedAt: new Date('2026-08-11T22:47:56.028Z'),
      decisionNote:
        'RECONSTRUCTED RECORD. Originally approved through the approval chain "ApprovedPO" at ' +
        '22:47:56 on 2026-08-11, and the document was signed at 22:47:59. This row was deleted in ' +
        'error by a verification script and rebuilt from the timeline read taken moments before. ' +
        'The requester\'s own stated reason and the linked approval request id were lost and are ' +
        'not reproduced here.',
      rules: {
        create: [
          {
            ruleId: 'cmsoojcj10003qdrueppaad3f',
            ruleName: 'Attached PO amount must match the invoice',
          },
        ],
      },
    },
    include: { rules: true, recipient: { select: { name: true, email: true } } },
  });

  console.log('restored:', JSON.stringify(created, null, 2));
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await p.$disconnect();
    process.exit(0);
  });
