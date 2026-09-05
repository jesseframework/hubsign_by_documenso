import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { DocumentAnnotationType } from '@prisma/client';
import { Trash2Icon } from 'lucide-react';

import type {
  TCreateAnnotationShape,
  TDocumentAnnotation,
} from '@documenso/lib/types/document-annotation';
import { ANNOTATION_MAX_NOTE_LENGTH } from '@documenso/lib/types/document-annotation';

import { cn } from '../../lib/utils';
import { Button } from '../button';
import { Textarea } from '../textarea';
import type { AnnotationPoint, AnnotationTool } from './types';

export type PDFAnnotationLayerProps = {
  pageIndex: number;
  annotations: TDocumentAnnotation[];
  tool: AnnotationTool;
  color: string;
  onCreate: (_shape: TCreateAnnotationShape) => void;
  onDelete: (_id: string) => void;
  /**
   * Markup mode. Off, the layer still paints everyone's annotations but never
   * takes a pointer event — the document underneath stays clickable, which is
   * what field placement in the editor depends on.
   */
  isEditing: boolean;
};

/** Anything smaller than this is a stray click, not a highlight. */
const MIN_HIGHLIGHT_SIZE_PERCENT = 0.5;

/** Defaults for a freshly dropped note, as percentages of the page. */
const NOTE_DEFAULT_WIDTH_PERCENT = 24;
const NOTE_FONT_SIZE_PERCENT = 1.1;
const NOTE_PADDING_RATIO = 0.5;
const NOTE_LINE_HEIGHT_RATIO = 1.25;

type Draft = { kind: 'highlight'; start: AnnotationPoint; current: AnnotationPoint };

/**
 * The markup surface for a single PDF page.
 *
 * Everything here works in percentages of the page box rather than pixels, the
 * same units the annotations are stored and sealed in. That is what lets a
 * highlight drawn at 200% zoom land in the same place at 75%, on a phone, and
 * in the final PDF — the layer never needs to know what size it is being shown
 * at, only its own proportions.
 */
export const PDFAnnotationLayer = ({
  pageIndex,
  annotations,
  tool,
  color,
  onCreate,
  onDelete,
  isEditing,
}: PDFAnnotationLayerProps) => {
  const $root = useRef<HTMLDivElement>(null);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [noteAnchor, setNoteAnchor] = useState<AnnotationPoint | null>(null);

  // The page re-renders at a new size on every zoom step and on window resize.
  // Measuring the element itself, rather than tracking zoom, keeps the overlay
  // correct no matter what changed the size.
  useLayoutEffect(() => {
    const $el = $root.current;

    if (!$el) return;

    const measure = () => {
      const { width, height } = $el.getBoundingClientRect();

      setSize({ width, height });
    };

    measure();

    const observer = new ResizeObserver(measure);

    observer.observe($el);

    return () => observer.disconnect();
  }, []);

  // Switching tools mid-stroke would otherwise commit whatever was half drawn.
  useEffect(() => {
    setDraft(null);
    setNoteAnchor(null);
  }, [tool]);

  const toPercent = useCallback((event: React.PointerEvent<HTMLDivElement>): AnnotationPoint => {
    const rect = event.currentTarget.getBoundingClientRect();

    // Clamped because a pointer that leaves the page mid-drag still reports
    // positions, and markup outside the page cannot be drawn onto it.
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * 100),
      y: clamp(((event.clientY - rect.top) / rect.height) * 100),
    };
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tool === 'none') return;

    // Stops the drag turning into a text selection across the page.
    event.preventDefault();

    const point = toPercent(event);

    if (tool === 'note') {
      setNoteAnchor(point);
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);

    setDraft({ kind: 'highlight', start: point, current: point });
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draft) return;

    const point = toPercent(event);

    setDraft((current) => (current ? { ...current, current: point } : current));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draft) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const rect = normalizeRect(draft.start, draft.current);

    if (rect.width >= MIN_HIGHLIGHT_SIZE_PERCENT && rect.height >= MIN_HIGHLIGHT_SIZE_PERCENT) {
      onCreate({
        pageIndex,
        type: DocumentAnnotationType.HIGHLIGHT,
        ...rect,
        color,
        opacity: 0.4,
      });
    }

    setDraft(null);
  };

  const onCreateNote = (text: string) => {
    if (!noteAnchor || size.width === 0 || size.height === 0) return;

    const shape = buildNoteShape({ anchor: noteAnchor, text, size, pageIndex, color });

    onCreate(shape);
    setNoteAnchor(null);
  };

  const pageAnnotations = annotations.filter((annotation) => annotation.pageIndex === pageIndex);

  const notes = pageAnnotations.filter(
    (annotation) => annotation.type === DocumentAnnotationType.NOTE,
  );

  const hasMeasured = size.width > 0 && size.height > 0;

  return (
    <div ref={$root} className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {hasMeasured && (
        <svg
          width={size.width}
          height={size.height}
          className="pointer-events-none absolute inset-0"
          aria-hidden
        >
          {pageAnnotations.map((annotation) => (
            <AnnotationShape key={annotation.id} annotation={annotation} size={size} />
          ))}

          {draft && (
            <rect
              {...toPixelRect(normalizeRect(draft.start, draft.current), size)}
              fill={color}
              opacity={0.4}
              style={{ mixBlendMode: 'multiply' }}
            />
          )}
        </svg>
      )}

      {notes.map((annotation) => (
        <NoteCard key={annotation.id} annotation={annotation} size={size} />
      ))}

      {/*
        Delete handles live above the shapes but below the capture surface, so
        clearing markup means switching back to the cursor first. A stray click
        while a tool is down should mark up, never destroy.
      */}
      {isEditing &&
        tool === 'none' &&
        pageAnnotations
          .filter((annotation) => annotation.isOwn)
          .map((annotation) => (
            <button
              key={`delete-${annotation.id}`}
              type="button"
              onClick={() => onDelete(annotation.id)}
              title="Remove annotation"
              className="border-border bg-card text-muted-foreground hover:border-destructive hover:text-destructive pointer-events-auto absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm transition-colors"
              style={{
                left: ((annotation.x + annotation.width) / 100) * size.width,
                top: (annotation.y / 100) * size.height,
              }}
            >
              <Trash2Icon className="h-2.5 w-2.5" />
            </button>
          ))}

      {/*
        The capture surface. Mounted only while a tool is held, so in every
        other state — including every PDFViewer that never turns markup on —
        the page underneath keeps the clicks it has always had.
      */}
      {isEditing && tool !== 'none' && (
        <div
          className={cn('pointer-events-auto absolute inset-0', {
            'cursor-crosshair': tool === 'highlight',
            'cursor-copy': tool === 'note',
          })}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      )}

      {noteAnchor && (
        <NoteComposer
          anchor={noteAnchor}
          size={size}
          color={color}
          onCancel={() => setNoteAnchor(null)}
          onSave={onCreateNote}
        />
      )}
    </div>
  );
};

const AnnotationShape = ({
  annotation,
  size,
}: {
  annotation: TDocumentAnnotation;
  size: { width: number; height: number };
}) => {
  // Notes are drawn as HTML cards below, so the SVG layer only carries
  // highlights.
  if (annotation.type !== DocumentAnnotationType.HIGHLIGHT) {
    return null;
  }

  return (
    <rect
      {...toPixelRect(annotation, size)}
      fill={annotation.color}
      opacity={annotation.opacity}
      // Multiply is what makes this read as a highlighter rather than a
      // sticker — and it matches the blend mode used when sealing.
      style={{ mixBlendMode: 'multiply' }}
    />
  );
};

const NoteCard = ({
  annotation,
  size,
}: {
  annotation: TDocumentAnnotation;
  size: { width: number; height: number };
}) => {
  const fontSize = ((annotation.fontSize ?? NOTE_FONT_SIZE_PERCENT) / 100) * size.height;

  return (
    <div
      className="pointer-events-none absolute overflow-hidden rounded-[2px] border bg-white/95 leading-snug text-[#1a1a1f] shadow-sm"
      style={{
        left: (annotation.x / 100) * size.width,
        top: (annotation.y / 100) * size.height,
        width: (annotation.width / 100) * size.width,
        height: (annotation.height / 100) * size.height,
        borderColor: annotation.color,
        padding: fontSize * NOTE_PADDING_RATIO,
        fontSize,
      }}
      title={annotation.createdByName ? `Note by ${annotation.createdByName}` : undefined}
    >
      <span className="whitespace-pre-wrap break-words">{annotation.text}</span>
    </div>
  );
};

const NoteComposer = ({
  anchor,
  size,
  color,
  onSave,
  onCancel,
}: {
  anchor: AnnotationPoint;
  size: { width: number; height: number };
  color: string;
  onSave: (_text: string) => void;
  onCancel: () => void;
}) => {
  const [text, setText] = useState('');

  // Kept just inside the page so a note dropped near the right or bottom edge
  // does not open its editor off the end of the document.
  const width = Math.min(260, Math.max(size.width * 0.4, 180));
  const left = Math.min((anchor.x / 100) * size.width, Math.max(size.width - width - 8, 0));
  const top = Math.min((anchor.y / 100) * size.height, Math.max(size.height - 150, 0));

  return (
    <div
      className="border-border bg-card pointer-events-auto absolute z-30 rounded-[var(--r-md,0.5rem)] border p-2 shadow-lg"
      style={{ left, top, width, borderTopColor: color, borderTopWidth: 3 }}
    >
      <Textarea
        autoFocus
        value={text}
        maxLength={ANNOTATION_MAX_NOTE_LENGTH}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }

          // Enter alone should make a new line in a note — this is prose, not a
          // form field. Sending needs the modifier.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && text.trim()) {
            event.preventDefault();
            onSave(text.trim());
          }
        }}
        placeholder="Add a note…"
        className="min-h-[64px] resize-none text-[13px]"
      />

      <div className="mt-2 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>

        <Button type="button" size="sm" disabled={!text.trim()} onClick={() => onSave(text.trim())}>
          <Trans>Add note</Trans>
        </Button>
      </div>
    </div>
  );
};

/**
 * Size a note's card to the text it holds, so what the browser shows and what
 * the seal draws agree. The character-width estimate is rough — it only has to
 * be close enough that the card is not obviously too short.
 */
const buildNoteShape = ({
  anchor,
  text,
  size,
  pageIndex,
  color,
}: {
  anchor: AnnotationPoint;
  text: string;
  size: { width: number; height: number };
  pageIndex: number;
  color: string;
}): TCreateAnnotationShape => {
  const widthPercent = NOTE_DEFAULT_WIDTH_PERCENT;
  const widthPx = (widthPercent / 100) * size.width;
  const fontPx = (NOTE_FONT_SIZE_PERCENT / 100) * size.height;
  const paddingPx = fontPx * NOTE_PADDING_RATIO;

  const charsPerLine = Math.max(Math.floor((widthPx - paddingPx * 2) / (fontPx * 0.5)), 8);

  const lineCount = text
    .split('\n')
    .reduce((total, line) => total + Math.max(Math.ceil(line.length / charsPerLine), 1), 0);

  const heightPx = lineCount * fontPx * NOTE_LINE_HEIGHT_RATIO + paddingPx * 2;
  const heightPercent = clamp((heightPx / size.height) * 100);

  return {
    pageIndex,
    type: DocumentAnnotationType.NOTE,
    // Pulled back from the edge so the whole card stays on the page.
    x: clamp(Math.min(anchor.x, 100 - widthPercent)),
    y: clamp(Math.min(anchor.y, 100 - heightPercent)),
    width: widthPercent,
    height: heightPercent,
    text,
    color,
    opacity: 1,
    fontSize: NOTE_FONT_SIZE_PERCENT,
  };
};

const clamp = (value: number) => Math.min(Math.max(value, 0), 100);

const normalizeRect = (start: AnnotationPoint, end: AnnotationPoint) => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y),
});

const toPixelRect = (
  rect: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number },
) => ({
  x: (rect.x / 100) * size.width,
  y: (rect.y / 100) * size.height,
  width: (rect.width / 100) * size.width,
  height: (rect.height / 100) * size.height,
});
