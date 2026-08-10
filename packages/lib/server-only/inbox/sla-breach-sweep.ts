/**
 * Mark the mailbox copy read once an invoice has blown its SLA.
 *
 * The reasoning is the same as for opening an item: an invoice past its target
 * is no longer something the mailbox should be nagging about, because it has
 * become the SLA dashboard's problem and will be chased from there. Leaving it
 * unread in WorkHub means two systems both claim to be the queue.
 *
 * Runs on a schedule rather than off an event because SLA state is computed, not
 * stored — nothing "happens" at the moment a target elapses. A sweep is the
 * honest shape for that: it asks the same question the dashboard asks, just
 * periodically.
 *
 * Only the INTERNAL clock counts here. End-to-end depends on the signer, and a
 * document sitting with a slow counterparty is not a mailbox item anyone needs
 * to action.
 */

import { prisma } from '@documenso/prisma';

import { markInboxEmailRead } from './mark-email-read';
import { SLA_ORG_SELECT, evaluateItemsSla } from './sla';

/** How far back to consider. Older unread mail is not going to become urgent. */
const LOOKBACK_DAYS = 120;

export type SlaBreachSweepResult = {
  organizationsChecked: number;
  breached: number;
  marked: number;
};

export const sweepSlaBreachesForOrg = async (organizationId: number): Promise<number> => {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: SLA_ORG_SELECT,
  });

  if (!org?.slaEnabled) {
    return 0;
  }

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  // Only items whose mailbox copy is still unread — everything else is already
  // where we want it, and this keeps the query small as history grows.
  const items = await prisma.signatureInboxItem.findMany({
    where: {
      organizationId,
      createdAt: { gte: since },
      status: { not: 'ARCHIVED' },
      emailReadAt: null,
      externalMessageId: { not: null },
    },
    select: {
      id: true,
      createdAt: true,
      receivedAt: true,
      senderEmail: true,
      subject: true,
      extractedData: true,
      documentId: true,
      document: { select: { status: true, completedAt: true } },
    },
    take: 500,
  });

  if (items.length === 0) {
    return 0;
  }

  const results = await evaluateItemsSla({ organizationId, org, items });
  const breached = results.filter((r) => r.internal.state === 'breached');

  let marked = 0;
  for (const result of breached) {
    const outcome = await markInboxEmailRead({
      organizationId,
      inboxItemId: result.inboxItemId,
      reason: 'sla-breach',
    });

    if (outcome === 'marked') {
      marked += 1;
      continue;
    }

    // The credential is short a permission, or there is no credential at all.
    // Every remaining item would fail the same way, so stop instead of spending
    // the organization's API quota on a few dozen identical refusals every time
    // this job ticks.
    if (outcome === 'forbidden' || outcome === 'not-configured') {
      console.warn(
        `[sla-sweep] org ${organizationId}: mark-read unavailable (${outcome}) — ` +
          `abandoning this sweep after ${marked} of ${breached.length}`,
      );
      break;
    }
  }

  if (marked > 0) {
    console.log(
      `[sla-sweep] org ${organizationId}: marked ${marked} of ${breached.length} breached item(s) read`,
    );
  }

  return marked;
};

export const sweepSlaBreaches = async (): Promise<SlaBreachSweepResult> => {
  const orgs = await prisma.organization.findMany({
    where: { slaEnabled: true },
    select: { id: true },
  });

  let marked = 0;
  for (const org of orgs) {
    // One organization's unreachable mailbox cluster must not stop the others.
    marked += await sweepSlaBreachesForOrg(org.id).catch((err) => {
      console.error(`[sla-sweep] org ${org.id} failed:`, err);
      return 0;
    });
  }

  return { organizationsChecked: orgs.length, breached: marked, marked };
};
