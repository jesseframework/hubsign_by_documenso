import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { BRAND, CHROME } from './chart-tokens';

export type TrendPoint = {
  label: string;
  count: number;
};

const tooltipStyle = {
  background: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 'var(--r-sm)',
  fontSize: 12,
  color: 'hsl(var(--popover-foreground))',
} as const;

const axisProps = {
  stroke: CHROME.axis,
  tick: { fill: CHROME.tick, fontSize: 10 },
  tickLine: false,
} as const;

/**
 * Twelve-month area trend. Single series, so it carries no legend — the card
 * title names it. The fill uses the org's own brand colour via `--primary`
 * rather than a fixed hue, so the chart re-tints with the organization's
 * branding settings.
 */
export const TrendAreaChart = ({
  data,
  height = 150,
  seriesName,
}: {
  data: TrendPoint[];
  height?: number;
  seriesName: string;
}) => {
  const gradientId = `trend-${seriesName.replace(/\W/g, '-')}`;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: -14 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND.primary} stopOpacity={0.28} />
            <stop offset="100%" stopColor={BRAND.primary} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <CartesianGrid stroke={CHROME.grid} strokeDasharray="2 4" vertical={false} />
        {/*
          Ticks are the month alone ("Sep"), not "Sep 2025": twelve rotated
          full labels overflowed the plot and clipped the first one. The window
          is twelve months so a month never repeats, the card footer carries the
          range, and the tooltip still shows the full label.
        */}
        <XAxis
          dataKey="label"
          interval="preserveStartEnd"
          minTickGap={4}
          tickFormatter={(value: string) => value.split(' ')[0]}
          height={20}
          {...axisProps}
        />
        <YAxis allowDecimals={false} width={30} {...axisProps} />

        <Tooltip
          contentStyle={tooltipStyle}
          itemStyle={{ color: 'hsl(var(--popover-foreground))' }}
          cursor={{ stroke: CHROME.tick, strokeWidth: 1, strokeDasharray: '3 3' }}
          formatter={(value: number) => [value.toLocaleString(), seriesName]}
        />

        <Area
          type="monotone"
          dataKey="count"
          stroke={BRAND.primary}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'hsl(var(--card))' }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
};

/**
 * Two-bar month-over-month comparison. The previous month is drawn in a muted
 * tint of the same brand hue so the current month reads as the subject — one
 * hue, two weights, rather than two competing colours.
 */
export const ComparisonBarChart = ({
  data,
  height = 130,
}: {
  data: TrendPoint[];
  height?: number;
}) => {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: -14 }}>
        <CartesianGrid stroke={CHROME.grid} strokeDasharray="2 4" vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis allowDecimals={false} width={38} {...axisProps} />

        <Tooltip
          contentStyle={tooltipStyle}
          itemStyle={{ color: 'hsl(var(--popover-foreground))' }}
          cursor={{ fill: BRAND.primarySoft }}
          formatter={(value: number) => [value.toLocaleString(), 'Documents']}
        />

        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}>
          {data.map((point, index) => {
            const isCurrent = index === data.length - 1;

            return (
              <Cell
                key={point.label}
                fill={isCurrent ? BRAND.primary : BRAND.primarySoft}
                // The prior month is a wash, so it needs an outline to stay
                // visible; the current month is solid and needs none.
                stroke={isCurrent ? 'none' : BRAND.primary}
                strokeWidth={isCurrent ? 0 : 1}
              />
            );
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};
