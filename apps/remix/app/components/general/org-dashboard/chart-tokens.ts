/**
 * Chart color slots for the organization dashboard.
 *
 * Two rules govern what lives here:
 *
 * 1. **Brand-driven marks read CSS variables, never hex.** Single-series marks
 *    (trends, month-over-month, top senders, the inbox split) use
 *    `--brand-chart`, which `OrgBrandingProvider` rewrites at runtime from the
 *    org's `brandingPrimaryColor`. Note it is *not* `--primary`: that variable
 *    prefers `brandingButtonColor`, so an org with purple buttons and a blue
 *    brand would get purple charts. Nothing here hardcodes a brand hue.
 *
 * 2. **Semantic scales are fixed hex and never themed.** A "rejected" slice
 *    must stay red even for an org whose brand colour is red-adjacent, so the
 *    status and aging scales are pinned. Both were validated with the dataviz
 *    palette validator against this app's real surfaces (light `#ffffff`, dark
 *    `#101018` — the `--card` token in each mode):
 *
 *    - Status, adjacent pairlist: worst CVD ΔE 11.8 light / 7.8 dark, worst
 *      normal-vision ΔE 18.3 light / 17.3 dark. The dark figure sits in the
 *      6–8 band that is legal only with secondary encoding, which is why every
 *      donut here ships a value legend and 2px segment gaps.
 *    - The `draft` slot deliberately fails the chroma floor: it reads gray
 *      because "draft" means *nothing has happened yet*, matching the gray
 *      draft badge already used in the document tables. Its position in the
 *      ring is also load-bearing — it sits between amber and red so those two
 *      (CVD ΔE 3.0, indistinguishable to a deuteranope) are never adjacent.
 *    - Aging is an ordinal ramp, not a categorical one: one hue, light→dark,
 *      all adjacent ΔL ≥ 0.06, light end clearing 2:1 on its surface.
 */

export type ChartMode = 'light' | 'dark';

/** Document / approval state. Ordered green → amber → gray → red; see note above. */
export const STATUS_COLORS: Record<ChartMode, Record<string, string>> = {
  light: {
    complete: '#1c9c6d',
    pending: '#eda100',
    draft: '#6d6783',
    rejected: '#a8261c',
  },
  dark: {
    complete: '#199e70',
    pending: '#c98500',
    draft: '#847e9a',
    rejected: '#e66767',
  },
};

/** Ordinal ramp for signature-aging buckets: current → 90+ days. */
export const AGING_RAMP: Record<ChartMode, string[]> = {
  light: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'],
  dark: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#184f95'],
};

/**
 * Brand-driven slots, resolved from CSS variables so org branding flows through.
 *
 * The second slot is `--gold`, deliberately not `--accent`: in the base theme
 * `--accent` and `--primary` hold the *same* purple, so a two-series chart drawn
 * with that pair would render both series identically. `--gold` is the app's
 * secondary brand hue and is distinct from primary by construction. Because an
 * org can rebrand `--primary` to anything, a two-series chart using these slots
 * must still carry direct labels — hue alone is not guaranteed separable here.
 */
export const BRAND = {
  primary: 'hsl(var(--brand-chart))',
  primarySoft: 'hsl(var(--brand-chart) / 0.16)',
  primaryTint: 'hsl(var(--brand-chart) / 0.10)',
  gold: 'hsl(var(--gold))',
} as const;

/** Recessive chrome — gridlines, axes and tick labels stay out of the way. */
export const CHROME = {
  grid: 'hsl(var(--border))',
  axis: 'hsl(var(--border))',
  tick: 'hsl(var(--muted-foreground))',
} as const;
