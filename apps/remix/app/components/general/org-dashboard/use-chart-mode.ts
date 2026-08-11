import { Theme, useTheme } from 'remix-themes';

import type { ChartMode } from './chart-tokens';

/**
 * Which palette column the charts should draw from.
 *
 * This deliberately mirrors how the shell decides to render dark: `root.tsx`
 * applies `className={theme ?? ''}`, so the `.dark` class — and therefore the
 * dark card surface the palette was validated against — appears only for an
 * explicit dark theme. An OS-level `prefers-color-scheme: dark` does *not* make
 * this app render dark, so keying off it here would pick dark steps for a light
 * surface and break contrast. `OrgBrandingProvider` uses the same test when it
 * steps `--brand-chart` for dark.
 */
export const useChartMode = (): ChartMode => {
  const [theme] = useTheme();

  return theme === Theme.DARK ? 'dark' : 'light';
};
