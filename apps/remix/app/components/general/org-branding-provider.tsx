import { useEffect } from 'react';

import { trpc } from '@documenso/trpc/react';

/**
 * Reads the current user's organization branding and pushes the colors as
 * CSS custom properties on `documentElement` so the entire app — every
 * Tailwind `bg-primary`, `text-primary`, `border-primary`, etc. — uses the
 * org's colors. No component-specific changes required.
 *
 * Tailwind's shared config defines tokens as `hsl(var(--primary))`, so we
 * convert each hex from the database to the HSL component string the CSS
 * variables expect (e.g. "262 80% 60%").
 *
 * On unmount the variables are cleared so users with no org go back to
 * default theme.
 */
export const OrgBrandingProvider = () => {
  const { data: orgMembership } = trpc.org.getMyOrganization.useQuery();
  const brand = orgMembership?.organization;

  useEffect(() => {
    const root = document.documentElement;

    // Map of: which org column → which CSS variable to override.
    // Empty / null values are skipped so we don't blow away the default theme.
    const map: Array<[hex: string | null | undefined, varName: string, isFg?: boolean]> = [
      // Buttons + accents — the primary token is the most-used.
      [brand?.brandingButtonColor ?? brand?.brandingPrimaryColor, '--primary'],
      [brand?.brandingButtonTextColor, '--primary-foreground', true],
      // The "ring" color follows primary so focus rings match.
      [brand?.brandingButtonColor ?? brand?.brandingPrimaryColor, '--ring'],
      // Accent for hover backgrounds, secondary CTAs.
      [brand?.brandingAccentColor, '--accent'],
    ];

    const applied: string[] = [];
    for (const [hex, varName] of map) {
      const hsl = hex ? hexToHslString(hex) : null;
      if (hsl) {
        root.style.setProperty(varName, hsl);
        applied.push(varName);
      }
    }

    return () => {
      // Restore defaults when the user signs out / loses their org.
      for (const v of applied) root.style.removeProperty(v);
    };
  }, [
    brand?.brandingPrimaryColor,
    brand?.brandingButtonColor,
    brand?.brandingButtonTextColor,
    brand?.brandingAccentColor,
  ]);

  return null;
};

/**
 * Convert "#7c5cfc" → "262 96% 68%" (the format Tailwind's
 * `hsl(var(--primary))` expects). Returns null on malformed input so we
 * don't override the variable with garbage.
 */
function hexToHslString(hex: string): string | null {
  let h = hex.trim();
  if (!h.startsWith('#')) h = `#${h}`;
  // Expand short form #abc to #aabbcc.
  if (h.length === 4) {
    h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  if (!/^#[0-9a-f]{6}$/i.test(h)) return null;

  const r = parseInt(h.slice(1, 3), 16) / 255;
  const g = parseInt(h.slice(3, 5), 16) / 255;
  const b = parseInt(h.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  let hue = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        hue = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        hue = (b - r) / d + 2;
        break;
      case b:
        hue = (r - g) / d + 4;
        break;
    }
    hue *= 60;
  }

  const round = (n: number) => Math.round(n * 10) / 10;
  return `${round(hue)} ${round(s * 100)}% ${round(l * 100)}%`;
}
