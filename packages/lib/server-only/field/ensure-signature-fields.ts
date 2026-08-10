/**
 * Guarantee that every recipient who must sign has somewhere to sign.
 *
 * Documents raised through the editor get their field layout placed by hand.
 * Documents that arrive by email do not — nobody has opened them in the editor,
 * so they carry no fields at all. Sending one produces a signing page with
 * nothing on it: the recipient opens the document, finds no signature box, and
 * either completes it without ever signing or simply gets stuck.
 *
 * So any automated send (the workflow action, the inbox's "send for signature")
 * lays down a default signature field first. This is a floor, not a layout
 * engine — the only promises are that a box exists and that it sits fully
 * within the page. The signer can drag it where it belongs, and a document
 * whose fields were placed in the editor is left untouched.
 */

import { FieldType, RecipientRole } from '@prisma/client';

import { prisma } from '@documenso/prisma';

/** Roles that apply a signature. CC and VIEWER take no action on the document. */
const ROLES_THAT_SIGN: RecipientRole[] = [RecipientRole.SIGNER, RecipientRole.APPROVER];

/**
 * Percentages of the page, matching how existing fields are stored, and sized
 * to what the editor produces for a signature box.
 *
 * Page 1 always exists, so the field can never land on a page that isn't there.
 */
const PAGE = 1;
const FIELD_WIDTH = 14;
const FIELD_HEIGHT = 3.5;
const FIRST_ROW_Y = 78;
const ROW_STEP = 5;
const COLUMN_X = [12, 55];

/** Every edge stays inside the page — the one thing that must not be got wrong. */
const MAX_X = 100 - FIELD_WIDTH;
const MAX_Y = 100 - FIELD_HEIGHT;

/**
 * Add a default signature field for every signing recipient that has none.
 *
 * Idempotent: recipients that already have any field are skipped, so calling
 * this before a resend, or on a document laid out in the editor, changes
 * nothing.
 *
 * @returns the number of fields created.
 */
export const ensureSignatureFields = async ({
  documentId,
}: {
  documentId: number;
}): Promise<number> => {
  const recipients = await prisma.recipient.findMany({
    where: { documentId },
    select: { id: true, role: true, _count: { select: { fields: true } } },
    orderBy: { id: 'asc' },
  });

  const needsField = recipients.filter(
    (recipient) => ROLES_THAT_SIGN.includes(recipient.role) && recipient._count.fields === 0,
  );

  if (needsField.length === 0) {
    return 0;
  }

  await prisma.field.createMany({
    data: needsField.map((recipient, index) => ({
      documentId,
      recipientId: recipient.id,
      type: FieldType.SIGNATURE,
      page: PAGE,
      // Two per row, then step down — so multiple signers don't stack on top of
      // each other and become un-clickable. Clamped so a long signer list can't
      // push a box off the bottom of the page.
      positionX: Math.min(COLUMN_X[index % COLUMN_X.length], MAX_X),
      positionY: Math.min(FIRST_ROW_Y + Math.floor(index / COLUMN_X.length) * ROW_STEP, MAX_Y),
      width: FIELD_WIDTH,
      height: FIELD_HEIGHT,
      customText: '',
      inserted: false,
    })),
  });

  return needsField.length;
};
