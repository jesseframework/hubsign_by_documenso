import { DocumentAnnotationType, DocumentStatus } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import type { AnnotationViewer } from '@documenso/lib/server-only/annotations/get-document-annotations';
import {
  getDocumentAnnotations,
  mapAnnotationRow,
} from '@documenso/lib/server-only/annotations/get-document-annotations';
import { getDocumentWhereInput } from '@documenso/lib/server-only/document/get-document-by-id';
import {
  ANNOTATION_MAX_NOTE_LENGTH,
  ANNOTATION_STYLE_DEFAULTS,
  ZAnnotationColor,
  ZCreateAnnotationShape,
  refineAnnotationShape,
} from '@documenso/lib/types/document-annotation';
import { prisma } from '@documenso/prisma';

import { maybeAuthenticatedProcedure, router } from '../trpc';

/**
 * How much markup one document will hold. A signing link is a write endpoint
 * that anyone holding the URL can reach, so it needs a ceiling that does not
 * depend on the caller being well behaved.
 */
const MAX_ANNOTATIONS_PER_DOCUMENT = 500;

/**
 * A document is reached either by id (a signed-in viewer) or by signing token
 * (whoever the link was sent to). Exactly one is required — `resolveAccess`
 * rejects a request that carries neither.
 */
const ZAnnotationTarget = z.object({
  documentId: z.number().int().positive().optional(),
  token: z.string().min(1).optional(),
});

export const annotationRouter = router({
  find: maybeAuthenticatedProcedure.input(ZAnnotationTarget).query(async ({ ctx, input }) => {
    const access = await resolveAccess(ctx, input);

    return getDocumentAnnotations({ documentId: access.documentId, viewer: access.viewer });
  }),

  create: maybeAuthenticatedProcedure
    .input(ZAnnotationTarget.merge(ZCreateAnnotationShape).superRefine(refineAnnotationShape))
    .mutation(async ({ ctx, input }) => {
      const access = await resolveAccess(ctx, input);

      assertDocumentAcceptsMarkup(access);

      const count = await prisma.documentAnnotation.count({
        where: { documentId: access.documentId },
      });

      if (count >= MAX_ANNOTATIONS_PER_DOCUMENT) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `A document can hold at most ${MAX_ANNOTATIONS_PER_DOCUMENT} annotations.`,
        });
      }

      const defaults = ANNOTATION_STYLE_DEFAULTS[input.type];

      const annotation = await prisma.documentAnnotation.create({
        data: {
          documentId: access.documentId,
          pageIndex: input.pageIndex,
          type: input.type,
          x: input.x,
          y: input.y,
          width: input.width,
          height: input.height,
          // Only notes carry text. Writing it unconditionally would leave
          // highlights with a field the renderer would have to second-guess.
          text: input.type === DocumentAnnotationType.NOTE ? input.text : undefined,
          color: input.color ?? defaults.color,
          opacity: input.opacity ?? defaults.opacity,
          fontSize: input.fontSize,
          createdByUserId: access.viewer.userId ?? undefined,
          createdByRecipientId: access.viewer.recipientId ?? undefined,
          createdByName: access.authorName,
        },
      });

      return mapAnnotationRow(annotation, access.viewer);
    }),

  update: maybeAuthenticatedProcedure
    .input(
      ZAnnotationTarget.extend({
        id: z.string().min(1),
        text: z.string().trim().max(ANNOTATION_MAX_NOTE_LENGTH).optional(),
        color: ZAnnotationColor.optional(),
        opacity: z.number().min(0.05).max(1).optional(),
        x: z.number().min(0).max(100).optional(),
        y: z.number().min(0).max(100).optional(),
        width: z.number().min(0).max(100).optional(),
        height: z.number().min(0).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const access = await resolveAccess(ctx, input);

      assertDocumentAcceptsMarkup(access);

      const annotation = await findModifiableAnnotation(input.id, access);

      const { id: _id, documentId: _documentId, token: _token, ...changes } = input;

      const updated = await prisma.documentAnnotation.update({
        where: { id: annotation.id },
        data: changes,
      });

      return mapAnnotationRow(updated, access.viewer);
    }),

  delete: maybeAuthenticatedProcedure
    .input(ZAnnotationTarget.extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const access = await resolveAccess(ctx, input);

      assertDocumentAcceptsMarkup(access);

      const annotation = await findModifiableAnnotation(input.id, access);

      await prisma.documentAnnotation.delete({ where: { id: annotation.id } });

      return { ok: true };
    }),
});

type ResolvedAccess = {
  documentId: number;
  viewer: AnnotationViewer;
  /** Display name stored on anything this caller draws. */
  authorName: string | null;
  /** Whether the document has already been sealed or removed. */
  isFinalised: boolean;
  /**
   * The document's owner may clear anyone's markup off it. Everyone else may
   * only touch their own.
   */
  canModerate: boolean;
};

/**
 * Work out which document this request is about and who is asking, from
 * whichever of the two credentials was supplied.
 *
 * The recipient id and the document id both come out of a server-side lookup,
 * never off the request: the token proves which recipient row the caller is,
 * and the session proves which user. That is what makes the `isOwn` flag on
 * every annotation — and therefore the right to edit it — worth anything.
 */
const resolveAccess = async (
  ctx: {
    user?: { id: number; name?: string | null; email: string } | null;
    teamId?: number | null;
  },
  target: { documentId?: number; token?: string },
): Promise<ResolvedAccess> => {
  if (target.token) {
    const recipient = await prisma.recipient.findFirst({
      where: { token: target.token },
      select: {
        id: true,
        name: true,
        email: true,
        documentId: true,
        document: { select: { id: true, userId: true, status: true, deletedAt: true } },
      },
    });

    if (!recipient?.documentId || !recipient.document) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Document could not be found' });
    }

    return {
      documentId: recipient.documentId,
      // A recipient who also happens to be signed in owns markup made under
      // either identity — the same person should not lose their own note by
      // arriving through a different door.
      viewer: { recipientId: recipient.id, userId: ctx.user?.id ?? null },
      authorName: recipient.name || recipient.email,
      isFinalised:
        recipient.document.status === DocumentStatus.COMPLETED ||
        Boolean(recipient.document.deletedAt),
      canModerate: Boolean(ctx.user && recipient.document.userId === ctx.user.id),
    };
  }

  if (!target.documentId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'A document id or a signing token is required.',
    });
  }

  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'You must be logged in to perform this action.',
    });
  }

  // Gated by the document's own access rule rather than a second one of its
  // own, so markup is never visible more widely than the document it is on.
  const where = await getDocumentWhereInput({
    documentId: target.documentId,
    userId: ctx.user.id,
    teamId: ctx.teamId ?? undefined,
  });

  const document = await prisma.document.findFirst({
    where,
    select: { id: true, userId: true, status: true, deletedAt: true },
  });

  if (!document) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Document could not be found' });
  }

  return {
    documentId: document.id,
    viewer: { userId: ctx.user.id },
    authorName: ctx.user.name || ctx.user.email,
    isFinalised: document.status === DocumentStatus.COMPLETED || Boolean(document.deletedAt),
    canModerate: document.userId === ctx.user.id,
  };
};

/**
 * Markup is flattened into the PDF at seal time, so a document that has already
 * been sealed can no longer take any. Refusing the write is the honest outcome
 * — accepting it would store markup that renders in the browser and is missing
 * from every copy of the signed document anyone downloads.
 */
const assertDocumentAcceptsMarkup = (access: ResolvedAccess): void => {
  if (access.isFinalised) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This document has been completed and can no longer be annotated.',
    });
  }
};

/** Load an annotation, confirming it belongs to this document and this caller. */
const findModifiableAnnotation = async (id: string, access: ResolvedAccess) => {
  const annotation = await prisma.documentAnnotation.findUnique({ where: { id } });

  // Checking the document as well as the id stops a caller with a valid token
  // for one document from reaching markup on another by guessing an id.
  if (!annotation || annotation.documentId !== access.documentId) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Annotation could not be found' });
  }

  const isOwn = mapAnnotationRow(annotation, access.viewer).isOwn;

  if (!isOwn && !access.canModerate) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You can only change annotations you added.',
    });
  }

  return annotation;
};
