import type { LucideIcon } from 'lucide-react/dist/lucide-react';

import { cn } from '@documenso/ui/lib/utils';

export type ChartCardProps = {
  title: React.ReactNode;
  /** Headline figure for the panel. Omit for panels whose chart is the whole story. */
  value?: string | number;
  icon?: LucideIcon;
  /** Tailwind class for the icon chip, for the fixed semantic tints. */
  iconBg?: string;
  /** Explicit chip colour, for brand-driven tints that can't be a static class. */
  iconBgColor?: string;
  iconColor?: string;
  /** Caption pinned to the bottom of the card, below the plot. */
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
};

/**
 * Shell for every plotted panel on the org dashboard: title and headline figure
 * top-left, tinted icon top-right, plot in the middle, caption pinned to the
 * bottom so captions line up across a row even when plots differ in height.
 */
export const ChartCard = ({
  title,
  value,
  icon: Icon,
  iconBg,
  iconBgColor,
  iconColor,
  footer,
  className,
  children,
}: ChartCardProps) => {
  return (
    <div
      className={cn(
        'flex flex-col rounded-[var(--r)] border border-border bg-card p-4',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold text-foreground">{title}</h3>

          {value !== undefined && (
            <p className="mt-1 text-2xl font-semibold leading-none text-foreground">{value}</p>
          )}
        </div>

        {Icon && (
          <div
            className={cn(
              'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[8px]',
              !iconBgColor && (iconBg || 'bg-primary/10'),
            )}
            style={iconBgColor ? { background: iconBgColor } : undefined}
          >
            <Icon className="h-4 w-4" style={iconColor ? { color: iconColor } : undefined} />
          </div>
        )}
      </div>

      <div className="mt-3 flex-1">{children}</div>

      {footer && <div className="mt-3 text-[11px] text-muted-foreground">{footer}</div>}
    </div>
  );
};
