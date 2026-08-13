/**
 * A pill toggle in HubSign's palette.
 *
 * Extracted from the Signature Inbox when the E-Sign list took the same filter
 * card: two copies of a control this small drift in a week, and the whole point of
 * porting the pattern was that the two lists filter alike.
 */
export function FilterChip({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-medium transition ${
        active
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border bg-background text-muted-foreground hover:bg-muted/50'
      }`}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </button>
  );
}

/** The label above a row of chips. */
export const FilterGroupLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
    {children}
  </p>
);
