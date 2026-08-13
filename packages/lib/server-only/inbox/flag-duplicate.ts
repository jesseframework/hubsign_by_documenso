/**
 * Resolve, store and announce whether an inbox item repeats an earlier invoice.
 *
 * Detection itself lives in the rules provider (`findDuplicateInboxItems`), which
 * decides *what* is a duplicate. This decides what happens about one: the verdict
 * is written onto the item so the queue can colour it without re-scanning every
 * other invoice on every page load, and `INBOX_DUPLICATE_DETECTED` fires so a
 * workflow can email the AP team and the vendor.
 *
 * The event fires on the TRANSITION into duplicate, not on every check. Checks
 * run again whenever someone corrects an extracted field, and an alert that
 * re-sent itself each time a typo was fixed would be ignored within a week.
 *
 * Nothing here is allowed to throw into its caller. Both callers are finishing
 * something more important than this — OCR completing, a correction being saved
 * — and neither should fail because a duplicate could not be looked up.
 */

import { prisma } from '@documenso/prisma';

import { OCR_FIELD_ALIASES, buildOcrCanonicalFields } from '../../universal/ocr-fields';
import { findDuplicateInboxItems } from '../rules/providers/duplicate';
import type { DuplicateFacts } from '../rules/providers/duplicate';
import { triggerWorkflows } from '../workflow/trigger-workflows';

export const flagDuplicateInboxItem = async (
  inboxItemId: string,
): Promise<DuplicateFacts | null> => {
  try {
    const item = await prisma.signatureInboxItem.findUnique({
      where: { id: inboxItemId },
      select: {
        id: true,
        organizationId: true,
        createdAt: true,
        extractedData: true,
        senderEmail: true,
        duplicateOfId: true,
        document: {
          select: {
            id: true,
            title: true,
            status: true,
            userId: true,
            // An alert needs a person's address: sending it to the organization's
            // inbound mailbox would deliver the warning into the very inbox it
            // is warning about.
            user: { select: { id: true, email: true, name: true } },
          },
        },
      },
    });

    if (!item) {
      return null;
    }

    const duplicate = await findDuplicateInboxItems({
      organizationId: item.organizationId,
      inboxItemId: item.id,
      extractedData: item.extractedData,
      receivedAt: item.createdAt,
    });

    const wasDuplicate = item.duplicateOfId !== null;

    await prisma.signatureInboxItem.update({
      where: { id: item.id },
      data: {
        duplicateOfId: duplicate.originalInboxItemId,
        duplicateMatchedOn: duplicate.matchedOn,
        duplicateCount: duplicate.count,
        duplicateCheckedAt: new Date(),
      },
    });

    if (duplicate.isDuplicate && !wasDuplicate) {
      console.warn(
        `[inbox] duplicate invoice: item ${item.id} matches ${duplicate.originalInboxItemId} ` +
          `on ${duplicate.matchedOn}${duplicate.originalAlreadySent ? ' (original ALREADY SENT)' : ''}`,
      );

      await triggerWorkflows({
        event: 'INBOX_DUPLICATE_DETECTED',
        organizationId: item.organizationId,
        data: {
          inboxItemId: item.id,
          duplicate,
          sender: item.senderEmail,
          extractedData: item.extractedData,
          ...buildOcrCanonicalFields(item.extractedData),
          owner: item.document.user
            ? {
                id: item.document.user.id,
                email: item.document.user.email,
                name: item.document.user.name,
              }
            : null,
          document: {
            id: item.document.id,
            title: item.document.title,
            status: item.document.status,
            userId: item.document.userId,
          },
        },
      });
    }

    return duplicate;
  } catch (err) {
    console.error('[inbox] duplicate detection failed:', err);
    return null;
  }
};

/**
 * The extracted values duplicate detection reads. A correction to any of them can
 * turn a duplicate into an original or the other way round; a correction to the
 * payment terms cannot, and re-scanning the queue for that would be waste.
 *
 * Derived from the alias table rather than restated, so a template naming its
 * total `grand_total` stays covered by adding the alias in one place.
 */
const DUPLICATE_INPUT_KEYS = new Set(
  (['vendorName', 'invoiceNumber', 'invoiceDate', 'totalAmount'] as const)
    .flatMap((field) => OCR_FIELD_ALIASES[field] as readonly string[])
    .map((alias) => alias.replace(/[^a-z0-9]+/g, '')),
);

/** Whether correcting `field` could change the duplicate verdict. */
export const affectsDuplicateCheck = (field: string): boolean =>
  DUPLICATE_INPUT_KEYS.has(field.toLowerCase().replace(/[^a-z0-9]+/g, ''));
