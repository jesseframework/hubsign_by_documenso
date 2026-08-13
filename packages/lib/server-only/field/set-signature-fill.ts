import { DocumentStatus, SigningStatus } from '@prisma/client';

import { isSignatureFieldType } from '@documenso/prisma/guards/is-signature-field';
import { prisma } from '@documenso/prisma';

import { clampSignatureFill } from '../../constants/signature-size';
import { AppError, AppErrorCode } from '../../errors/app-error';

/**
 * Change how large a signature is drawn inside its field.
 *
 * Its own endpoint rather than another call to `signFieldWithToken`, which
 * refuses an already-inserted field — and rightly so: that guard is what stops a
 * signature being replaced after the fact, and relaxing it to allow a resize
 * would have opened the same door to a new signature image.
 *
 * So this writes exactly one column, on a field that is already signed, for a
 * recipient who has not yet completed. Nothing here can change what was signed —
 * only how big it is drawn.
 */
export type SetSignatureFillOptions = {
  token: string;
  fieldId: number;
  fill: number;
};

export const setSignatureFill = async ({ token, fieldId, fill }: SetSignatureFillOptions) => {
  const field = await prisma.field.findFirst({
    where: {
      id: fieldId,
      recipient: { token },
    },
    include: {
      document: { select: { id: true, status: true } },
      recipient: { select: { id: true, signingStatus: true } },
      signature: { select: { id: true } },
    },
  });

  if (!field || !field.document) {
    throw new AppError(AppErrorCode.NOT_FOUND, { message: 'Field not found.' });
  }

  if (!isSignatureFieldType(field.type)) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Only a signature field has a size.',
    });
  }

  if (field.document.status !== DocumentStatus.PENDING) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'This document is no longer open for signing.',
    });
  }

  // Once the recipient has completed, their signature is evidence rather than a
  // draft: the document may already be sealed, and a size change afterwards would
  // make the sealed PDF and the record disagree.
  if (field.recipient.signingStatus === SigningStatus.SIGNED) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'You have already completed this document.',
    });
  }

  if (!field.inserted || !field.signature) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Sign the field before setting its size.',
    });
  }

  const updated = await prisma.signature.update({
    where: { id: field.signature.id },
    // Clamped, not rejected: a value out of range can only be a stale tab or a
    // hand-made request, and there is nothing here worth failing over.
    data: { signatureFill: clampSignatureFill(fill) },
    select: { id: true, signatureFill: true },
  });

  return { fieldId: field.id, signatureFill: Number(updated.signatureFill) };
};
