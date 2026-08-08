import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

export type DonutSlice = {
  label: string;
  value: number;
  color: string;
};

export type DonutChartProps = {
  data: DonutSlice[];
  height?: number;
  /** Renders as a filled pie rather than a ring. */
  solid?: boolean;
};

/**
 * Ring (or pie) with a value legend beneath it.
 *
 * The legend is not optional decoration — it carries the secondary encoding the
 * palette validation depends on. Several slots sit below 3:1 against the light
 * surface, and the dark status pairs land in the 6–8 CVD band, both of which are
 * only legal when identity is also carried by something other than hue. The
 * label-plus-value rows are that something, so they render for every series.
 *
 * Segments are separated by a 2px stroke in the card surface colour plus a
 * matching `paddingAngle`, which keeps adjacent arcs legible when two slices
 * happen to be close in hue.
 */
export const DonutChart = ({ data, height = 180, solid = false }: DonutChartProps) => {
  const total = data.reduce((sum, slice) => sum + slice.value, 0);
  const plotted = data.filter((slice) => slice.value > 0);

  if (total === 0) {
    return (
      <div
        className="flex items-center justify-center text-[12px] text-muted-foreground"
        style={{ height }}
      >
        No data yet
      </div>
    );
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={plotted}
            dataKey="value"
            nameKey="label"
            innerRadius={solid ? 0 : '58%'}
            outerRadius="86%"
            paddingAngle={plotted.length > 1 ? 2 : 0}
            stroke="hsl(var(--card))"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {plotted.map((slice) => (
              <Cell key={slice.label} fill={slice.color} />
            ))}
          </Pie>

          <Tooltip
            contentStyle={{
              background: 'hsl(var(--popover))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 'var(--r-sm)',
              fontSize: 12,
              color: 'hsl(var(--popover-foreground))',
            }}
            itemStyle={{ color: 'hsl(var(--popover-foreground))' }}
            formatter={(value: number, name: string) => [
              `${value.toLocaleString()} (${Math.round((value / total) * 100)}%)`,
              name,
            ]}
          />
        </PieChart>
      </ResponsiveContainer>

      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {data.map((slice) => (
          <li key={slice.label} className="flex items-center gap-1.5 text-[11px]">
            <span
              className="h-[7px] w-[7px] flex-shrink-0 rounded-full"
              style={{ background: slice.color }}
            />
            <span className="text-muted-foreground">{slice.label}</span>
            <span className="font-medium tabular-nums text-foreground">
              {slice.value.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
