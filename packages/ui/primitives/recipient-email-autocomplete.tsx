import { useEffect, useRef, useState } from 'react';

import { trpc } from '@documenso/trpc/react';

import { cn } from '../lib/utils';
import { Input } from './input';

export type RecipientEmailAutocompleteProps = {
  value: string;
  onChange: (value: string) => void;
  /**
   * Called when the user picks a suggestion. Use this to also fill in the
   * matching name field on the parent signer row.
   */
  onSelectMember?: (member: { id: number; name: string | null; email: string }) => void;
  placeholder?: string;
  disabled?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
};

/**
 * Email input with org-member autocomplete.
 * - Shows suggestions only when the current user belongs to an organization.
 * - Falls back to a plain email input for personal accounts (no popover).
 * - Picking a suggestion fills the email and also calls `onSelectMember`
 *   so the parent can fill the name field.
 */
export const RecipientEmailAutocomplete = ({
  value,
  onChange,
  onSelectMember,
  placeholder = 'Email',
  disabled,
  onKeyDown,
  className,
}: RecipientEmailAutocompleteProps) => {
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const { data: suggestions = [] } = trpc.org.searchMembers.useQuery(
    { query: value },
    {
      // Only run when the dropdown is open, to avoid background queries
      // for personal accounts that won't see the dropdown anyway.
      enabled: open,
      staleTime: 30_000,
    },
  );

  // Filter out the email already typed exactly (already filled).
  const filtered = suggestions.filter(
    (s) => s.email.toLowerCase() !== value.trim().toLowerCase(),
  );

  // Close on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const pick = (s: { id: number; name: string | null; email: string }) => {
    onChange(s.email);
    onSelectMember?.(s);
    setOpen(false);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open && filtered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIdx((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        const s = filtered[highlightIdx];
        if (s) {
          e.preventDefault();
          pick(s);
          return;
        }
      }
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <Input
        type="email"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlightIdx(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        disabled={disabled}
        autoComplete="off"
      />

      {open && filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-auto rounded-md border border-border bg-card shadow-md">
          {filtered.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={cn(
                'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] transition-colors',
                i === highlightIdx ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
              )}
              onMouseEnter={() => setHighlightIdx(i)}
              onMouseDown={(e) => {
                // Use mousedown so it fires before input blur.
                e.preventDefault();
                pick(s);
              }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{s.name || s.email}</p>
                {s.name && (
                  <p className="truncate text-[11px] text-muted-foreground">{s.email}</p>
                )}
              </div>
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                Org
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
