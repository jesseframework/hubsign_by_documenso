import { useCallback, useMemo } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';

import type {
  TCreateAnnotationShape,
  TDocumentAnnotation,
} from '@documenso/lib/types/document-annotation';
import { trpc } from '@documenso/trpc/react';

import { useToast } from '../use-toast';

export type UsePdfAnnotationsOptions = {
  /** The document being annotated, for a signed-in viewer. */
  documentId?: number;
  /** The signing token, for someone working from a signing link. */
  token?: string;
  /** Markup is off unless a caller opts in — most PDFViewer usages don't. */
  enabled?: boolean;
};

export type UsePdfAnnotationsResult = {
  annotations: TDocumentAnnotation[];
  isLoading: boolean;
  isSaving: boolean;
  create: (shape: TCreateAnnotationShape) => void;
  remove: (id: string) => void;
  updateText: (id: string, text: string) => void;
};

/**
 * Owns the markup on one document: the list, and the three mutations that
 * change it.
 *
 * Every mutation invalidates rather than patching the cache by hand. Markup is
 * shared — a document open in two places, or annotated by a signer while the
 * sender watches, should converge on what the server actually holds rather than
 * on what each client guessed. The drawing surface keeps its own in-progress
 * shape locally, so the round trip is not something the person drawing feels.
 */
export const usePdfAnnotations = ({
  documentId,
  token,
  enabled = false,
}: UsePdfAnnotationsOptions): UsePdfAnnotationsResult => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  // The token identifies both the document and the person, so it wins when
  // both are around — on the signing page that is the only credential the
  // viewer is guaranteed to have.
  const target = useMemo(() => {
    if (token) return { token };
    if (documentId) return { documentId };

    return null;
  }, [documentId, token]);

  const isEnabled = enabled && target !== null;

  const { data, isLoading } = trpc.annotation.find.useQuery(target ?? {}, {
    enabled: isEnabled,
  });

  const onError = useCallback(
    (error: { message?: string }) => {
      toast({
        title: _(msg`Annotation not saved`),
        description: error.message || _(msg`Something went wrong. Please try again.`),
        variant: 'destructive',
      });
    },
    [_, toast],
  );

  const onSettled = useCallback(async () => {
    if (target) {
      await utils.annotation.find.invalidate(target);
    }
  }, [target, utils]);

  const createMutation = trpc.annotation.create.useMutation({ onError, onSettled });
  const deleteMutation = trpc.annotation.delete.useMutation({ onError, onSettled });
  const updateMutation = trpc.annotation.update.useMutation({ onError, onSettled });

  const create = useCallback(
    (shape: TCreateAnnotationShape) => {
      if (!target) return;

      createMutation.mutate({ ...target, ...shape });
    },
    [createMutation, target],
  );

  const remove = useCallback(
    (id: string) => {
      if (!target) return;

      deleteMutation.mutate({ ...target, id });
    },
    [deleteMutation, target],
  );

  const updateText = useCallback(
    (id: string, text: string) => {
      if (!target) return;

      updateMutation.mutate({ ...target, id, text });
    },
    [target, updateMutation],
  );

  return {
    annotations: isEnabled ? (data ?? []) : [],
    isLoading: isEnabled && isLoading,
    isSaving: createMutation.isPending || deleteMutation.isPending || updateMutation.isPending,
    create,
    remove,
    updateText,
  };
};
