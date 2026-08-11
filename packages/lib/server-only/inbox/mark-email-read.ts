/**
 * Tell WorkHub that an inbound message has been dealt with.
 *
 * Three things independently mean "this mail no longer needs a human's eye in
 * the mailbox": HubSign imported it, someone opened it in the Signature Inbox,
 * or its SLA ran out and it became the SLA dashboard's problem instead. All
 * three funnel through here so the mailbox agrees with HubSign no matter which
 * happened first.
 *
 * Two properties matter more than the call itself:
 *
 *   IDEMPOTENT  `emailReadAt` records the confirmed call, so the second and
 *               third trigger cost nothing. Without it, every page load of an
 *               opened item would hit the mailbox again.
 *   NEVER FATAL The mailbox is a remote system on someone else's cluster. It
 *               returns 409 for clusters without inbox support and 404 for a
 *               mailbox with no linked proxy profile — neither is a reason to
 *               fail the page the user is actually looking at.
 */

import { prisma } from '@documenso/prisma';

import type { WorkHubInboxConfig } from './workhub-inbox-client';
import {
  WorkHubInboxError,
  isWorkHubInboxConfigured,
  resolveMailboxId,
  workhubMarkRead,
} from './workhub-inbox-client';

/**
 * The mailbox message id behind an inbox item.
 *
 * An email with several PDFs becomes several inbox items, each keyed
 * `<messageId>:<attachmentId>` so they stay distinct. Mark-read addresses the
 * message, so the attachment half is dropped — and marking one attachment's row
 * read marks the whole message read, which is correct: the mailbox has one
 * message, not one per attachment.
 */
export const inboxEmailIdOf = (externalMessageId: string | null): string | null => {
  const id = externalMessageId?.trim();
  if (!id) return null;

  const separator = id.indexOf(':');
  const emailId = separator === -1 ? id : id.slice(0, separator);

  return emailId || null;
};

type MarkReadReason = 'imported' | 'opened' | 'sla-breach';

export type MarkReadOutcome =
  | 'marked'
  /** Already done, or there is no mailbox message behind this item. */
  | 'skipped'
  /** No WorkHub credential on this organization. */
  | 'not-configured'
  /** The credential lacks `email.update`. Retrying changes nothing. */
  | 'forbidden'
  | 'failed';

/**
 * Mark the source message read, at most once per inbox item.
 *
 * Never throws: the mailbox is a remote system and this is a side errand, not
 * the caller's actual job. The outcome is returned so a batch caller can tell a
 * transient failure from one that will repeat forever.
 */
export const markInboxEmailRead = async ({
  organizationId,
  inboxItemId,
  reason,
}: {
  organizationId: number;
  inboxItemId: string;
  reason: MarkReadReason;
}): Promise<MarkReadOutcome> => {
  try {
    const item = await prisma.signatureInboxItem.findFirst({
      where: { id: inboxItemId, organizationId },
      select: { id: true, externalMessageId: true, emailReadAt: true },
    });

    if (!item || item.emailReadAt) {
      return 'skipped';
    }

    const emailId = inboxEmailIdOf(item.externalMessageId);

    // Items created by upload rather than by the poller have no message behind
    // them. Stamp them anyway so this is not retried on every open.
    if (!emailId) {
      await prisma.signatureInboxItem.update({
        where: { id: item.id },
        data: { emailReadAt: new Date() },
      });
      return 'skipped';
    }

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        inboxEmail: true,
        workhubApiKey: true,
        workhubApiBase: true,
        workhubMailboxId: true,
        workhubUsername: true,
        workhubPassword: true,
      },
    });

    const config: WorkHubInboxConfig = {
      apiBase: org?.workhubApiBase,
      apiKey: org?.workhubApiKey,
      username: org?.workhubUsername,
      password: org?.workhubPassword,
      mailboxId: org?.workhubMailboxId,
    };

    if (!isWorkHubInboxConfigured(config)) {
      return 'not-configured';
    }

    // Only when the credential spans several mailboxes. Resolution can itself
    // fail against a misconfigured cluster, and that must not stop the attempt —
    // a single-mailbox key does not need the field at all.
    const mailboxId = await resolveMailboxId(config, org?.inboxEmail ?? undefined).catch(() => null);

    await workhubMarkRead(config, emailId, { isRead: true, mailboxId });

    await prisma.signatureInboxItem.update({
      where: { id: item.id },
      data: { emailReadAt: new Date() },
    });

    // Logged on success as well as failure. Silence is not confirmation — with
    // only the error path logged, a working mailbox and a mailbox nobody is
    // calling look identical from the outside.
    console.log(`[inbox] marked mailbox message read (${reason}) for item ${item.id}`);

    return 'marked';
  } catch (err) {
    // Deliberately swallowed: see the header. Logged so a mailbox that never
    // accepts mark-read is visible rather than silently ignored forever.
    if (err instanceof WorkHubInboxError && err.isPermissionDenied) {
      console.error(
        `[inbox] mark-read is not permitted for this organization's WorkHub key (${reason}). ` +
          `Add the ${err.missing?.join(', ') || 'email.update'} permission to the key in ` +
          `Org Settings → WorkHub inbox connection. ${err.message}`,
      );
      return 'forbidden';
    }

    console.error(`[inbox] mark-read failed (${reason}) for ${inboxItemId}:`, err);
    return 'failed';
  }
};
