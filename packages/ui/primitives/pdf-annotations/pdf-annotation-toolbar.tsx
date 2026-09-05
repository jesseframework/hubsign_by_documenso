import { Trans } from '@lingui/react/macro';
import { HighlighterIcon, MousePointer2Icon, StickyNoteIcon } from 'lucide-react';

import { ANNOTATION_COLORS } from '@documenso/lib/types/document-annotation';

import { cn } from '../../lib/utils';
import type { AnnotationTool } from './types';

export type PDFAnnotationToolbarProps = {
  tool: AnnotationTool;
  onToolChange: (_tool: AnnotationTool) => void;
  color: string;
  onColorChange: (_color: string) => void;
  isSaving?: boolean;
};

const TOOLS: { value: AnnotationTool; icon: typeof MousePointer2Icon; label: string }[] = [
  { value: 'none', icon: MousePointer2Icon, label: 'Select' },
  { value: 'highlight', icon: HighlighterIcon, label: 'Highlight' },
  { value: 'note', icon: StickyNoteIcon, label: 'Note' },
];

/**
 * Tool and colour picker for PDF markup, sized to sit in the viewer's existing
 * top bar next to the zoom controls rather than as a second row of chrome above
 * the document.
 */
export const PDFAnnotationToolbar = ({
  tool,
  onToolChange,
  color,
  onColorChange,
  isSaving,
}: PDFAnnotationToolbarProps) => (
  <div className="flex items-center gap-2">
    <div className="border-border bg-card inline-flex items-center gap-0.5 rounded-md border px-1 py-0.5">
      {TOOLS.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-pressed={tool === value}
          onClick={() => onToolChange(value)}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded transition-colors',
            tool === value
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Icon className="h-3 w-3" />
        </button>
      ))}
    </div>

    {/* The colour only matters once something is being drawn with it. */}
    {tool !== 'none' && (
      <div className="border-border bg-card inline-flex items-center gap-1 rounded-md border px-1.5 py-1">
        {ANNOTATION_COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            title={swatch}
            aria-label={`Use colour ${swatch}`}
            aria-pressed={color === swatch}
            onClick={() => onColorChange(swatch)}
            className={cn(
              'h-3.5 w-3.5 rounded-full ring-offset-1 transition-shadow',
              color === swatch && 'ring-foreground/40 ring-2 ring-offset-1',
            )}
            style={{ backgroundColor: swatch }}
          />
        ))}
      </div>
    )}

    {isSaving && (
      <span className="text-muted-foreground text-[11px]">
        <Trans>Saving…</Trans>
      </span>
    )}
  </div>
);
