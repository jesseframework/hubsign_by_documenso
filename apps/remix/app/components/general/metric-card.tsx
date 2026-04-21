import type { LucideIcon } from 'lucide-react/dist/lucide-react';

import { cn } from '@documenso/ui/lib/utils';

export type CardMetricProps = {
  icon?: LucideIcon;
  title: string;
  value: string | number;
  subtitle?: string;
  accentColor?: string;
  iconBg?: string;
  className?: string;
};

export const CardMetric = ({
  icon: Icon,
  title,
  value,
  subtitle,
  accentColor,
  iconBg,
  className,
}: CardMetricProps) => {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[var(--r)] border border-border bg-card p-3 sm:p-4',
        className,
      )}
    >
      {/* Bottom accent bar */}
      {accentColor && (
        <div
          className="absolute bottom-0 left-0 right-0 h-[3px] opacity-[0.18]"
          style={{ background: accentColor }}
        />
      )}

      {/* Icon - hidden on small screens */}
      {Icon && (
        <div
          className={cn(
            'absolute right-3 top-3 hidden h-7 w-7 items-center justify-center rounded-[7px] sm:flex',
            iconBg || 'bg-primary/10',
          )}
        >
          <Icon className="h-3.5 w-3.5" style={{ color: accentColor }} />
        </div>
      )}

      {/* Label */}
      <div className="text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground sm:text-[11px]">
        {title}
      </div>

      {/* Value */}
      <p className="mt-1 text-xl font-semibold leading-none tracking-tight text-foreground sm:mt-1.5 sm:text-2xl">
        {typeof value === 'number' ? value.toLocaleString('en-US') : value}
      </p>

      {/* Subtitle - hidden on small screens */}
      {subtitle && (
        <div className="mt-0.5 hidden text-[11px] text-muted-foreground sm:block">{subtitle}</div>
      )}
    </div>
  );
};
