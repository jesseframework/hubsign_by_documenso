import type { DocumentAnnotation } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import type { TDocumentAnnotation } from '../../types/document-annotation';

export type AnnotationViewer = {
  /** The signed-in user reading the document, if there is one. */
  userId?: number | null;
  /** The recipient whose signing token was used to reach the document, if any. */
  recipientId?: number | null;
};

/**
 * Turn a stored annotation into the shape the overlay draws, deciding — here on
 * the server — whether this particular viewer owns it.
 *
 * Ownership is what gates editing and deleting. A signing link is held by
 * whoever it was mailed to, so the recipient id is only ever trusted when it
 * came from resolving a token server-side, never from the request body.
 */
export const mapAnnotationRow = (
  annotation: DocumentAnnotation,
  viewer: AnnotationViewer,
): TDocumentAnnotation => {
  const isOwn = Boolean(
    (viewer.userId && annotation.createdByUserId === viewer.userId) ||
      (viewer.recipientId && annotation.createdByRecipientId === viewer.recipientId),
  );

  return {
    id: annotation.id,
    pageIndex: annotation.pageIndex,
    type: annotation.type,
    x: annotation.x,
    y: annotation.y,
    width: annotation.width,
    height: annotation.height,
    text: annotation.text,
    color: annotation.color,
    opacity: annotation.opacity,
    fontSize: annotation.fontSize,
    createdByName: annotation.createdByName,
    createdAt: annotation.createdAt,
    isOwn,
  };
};

export type GetDocumentAnnotationsOptions = {
  documentId: number;
  viewer: AnnotationViewer;
};

/**
 * Every annotation on a document, oldest first so later markup paints over
 * earlier markup in the same order the browser and the sealed PDF will use.
 *
 * Access is the caller's responsibility — this is reached both from an
 * authenticated router (which checks document access) and from the signing
 * loader (which has already resolved a valid token).
 */
export const getDocumentAnnotations = async ({
  documentId,
  viewer,
}: GetDocumentAnnotationsOptions): Promise<TDocumentAnnotation[]> => {
  const annotations = await prisma.documentAnnotation.findMany({
    where: { documentId },
    orderBy: { createdAt: 'asc' },
  });

  return annotations.map((annotation) => mapAnnotationRow(annotation, viewer));
};
