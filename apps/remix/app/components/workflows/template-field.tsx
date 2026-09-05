import { useMemo, useRef, useState } from 'react';

import { cn } from '@documenso/ui/lib/utils';

import type { TTemplateSuggestion } from './template-variables';

/**
 * Intellisense for `{{ path }}` template placeholders — a drop-in replacement
 * for a plain `<input>`/`<textarea>` that, while the cursor sits inside an
 * unclosed `{{ ... }}`, shows a filtered list of known variables and inserts
 * the chosen one at the cursor.
 */

const OPEN = '{{';
const CLOSE = '}}';
const MAX_SUGGESTIONS = 8;

/** Base look matching `@documenso/ui/primitives/input` — pass alongside a sizing className. */
export const TEMPLATE_INPUT_BASE_CLS =
  'bg-background border-input ring-offset-background placeholder:text-muted-foreground/40 focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2';

type TOpenPlaceholder = { start: number; query: string };

/** Is the cursor inside an unclosed `{{...}}`? If so, where does it start and what's been typed so far. */
const findOpenPlaceholder = (text: string, cursor: number): TOpenPlaceholder | null => {
  const openIndex = text.lastIndexOf(OPEN, cursor - 1);
  if (openIndex === -1) return null;

  const between = text.slice(openIndex + OPEN.length, cursor);
  if (between.includes(CLOSE)) return null;

  return { start: openIndex, query: between.trim() };
};

const filterSuggestions = (
  suggestions: TTemplateSuggestion[],
  query: string,
): TTemplateSuggestion[] => {
  if (!query) return suggestions.slice(0, MAX_SUGGESTIONS);
  const q = query.toLowerCase();
  return suggestions.filter((s) => s.path.toLowerCase().includes(q)).slice(0, MAX_SUGGESTIONS);
};

type TFieldElement = HTMLInputElement | HTMLTextAreaElement;

type TTemplateFieldProps = {
  value: string;
  onChange: (next: string) => void;
  suggestions: TTemplateSuggestion[];
  className?: string;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  title?: string;
  'aria-label'?: string;
};

export const TemplateField = ({
  value,
  onChange,
  suggestions,
  className,
  multiline,
  rows,
  ...rest
}: TTemplateFieldProps) => {
  const ref = useRef<TFieldElement>(null);
  const [open, setOpen] = useState<TOpenPlaceholder | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(
    () => (open ? filterSuggestions(suggestions, open.query) : []),
    [open, suggestions],
  );

  const isShowing = open !== null && matches.length > 0;

  const recompute = (el: TFieldElement) => {
    const cursor = el.selectionStart ?? el.value.length;
    setOpen(findOpenPlaceholder(el.value, cursor));
    setActiveIndex(0);
  };

  const insert = (path: string) => {
    const el = ref.current;
    if (!open || !el) return;

    const cursor = el.selectionStart ?? value.length;
    const before = value.slice(0, open.start);
    const after = value.slice(cursor);
    const insertion = `${OPEN}${path}${after.startsWith(CLOSE) ? '' : CLOSE}`;

    onChange(before + insertion + after);
    setOpen(null);

    requestAnimationFrame(() => {
      const pos = before.length + insertion.length;
      el.setSelectionRange(pos, pos);
      el.focus();
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<TFieldElement>) => {
    if (!isShowing) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insert(matches[activeIndex].path);
    } else if (e.key === 'Escape') {
      setOpen(null);
    }
  };

  const sharedProps = {
    ref: ref as never,
    value,
    className: cn(className),
    onChange: (e: React.ChangeEvent<TFieldElement>) => {
      onChange(e.target.value);
      recompute(e.target);
    },
    onKeyDown: handleKeyDown,
    onKeyUp: (e: React.KeyboardEvent<TFieldElement>) => recompute(e.currentTarget),
    onClick: (e: React.MouseEvent<TFieldElement>) => recompute(e.currentTarget),
    onBlur: () => setOpen(null),
    ...rest,
  };

  return (
    <div className="relative">
      {multiline ? (
        <textarea rows={rows} {...sharedProps} />
      ) : (
        <input type="text" {...sharedProps} />
      )}

      {isShowing && (
        <div className="bg-popover text-popover-foreground border-border absolute z-20 mt-1 max-h-56 w-full min-w-[260px] overflow-auto rounded-md border py-1 text-[12px] shadow-md">
          {matches.map((s, index) => (
            <button
              key={s.path}
              type="button"
              // onMouseDown (not onClick) fires before the field's onBlur, so the
              // dropdown doesn't close out from under the click.
              onMouseDown={(e) => {
                e.preventDefault();
                insert(s.path);
              }}
              className={cn(
                'flex w-full flex-col items-start gap-0 px-2 py-1 text-left',
                index === activeIndex ? 'bg-accent' : 'hover:bg-accent',
              )}
            >
              <span className="text-primary font-mono text-[12px]">{`{{${s.path}}}`}</span>
              <span className="text-muted-foreground text-[11px]">{s.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
