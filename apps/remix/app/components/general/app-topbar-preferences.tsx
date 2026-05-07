import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Globe, Languages, Monitor, Moon, Sun } from 'lucide-react';
import { Theme, useTheme } from 'remix-themes';

import { SUPPORTED_LANGUAGES } from '@documenso/lib/constants/i18n';
import { dynamicActivate } from '@documenso/lib/utils/i18n';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@documenso/ui/primitives/dropdown-menu';
import { useToast } from '@documenso/ui/primitives/use-toast';

/**
 * Two icon buttons that live in the topbar next to the search bar:
 *   - Theme: cycles Light / Dark / System via remix-themes
 *   - Language: switches the active i18n locale + persists to the cookie
 *     via the existing /api/locale endpoint
 *
 * Mirrors the behaviour of the Preferences group in the command palette but
 * without forcing the user to open the palette first.
 */
export const TopbarPreferences = () => {
  const { _, i18n } = useLingui();
  const { toast } = useToast();
  const [, setTheme] = useTheme();
  const [isLoading, setIsLoading] = useState(false);

  const themes = [
    { label: msg`Light`, theme: Theme.LIGHT, icon: Sun },
    { label: msg`Dark`, theme: Theme.DARK, icon: Moon },
    { label: msg`System`, theme: null, icon: Monitor },
  ] as const;

  const setLanguage = async (lang: string) => {
    if (isLoading || lang === i18n.locale) return;
    setIsLoading(true);
    try {
      await dynamicActivate(lang);
      const formData = new FormData();
      formData.append('lang', lang);
      const response = await fetch('/api/locale', { method: 'post', body: formData });
      if (!response.ok) throw new Error(response.statusText);
    } catch (e) {
      console.error('[topbar] language change failed:', e);
      toast({
        title: _(msg`An unknown error occurred`),
        variant: 'destructive',
        description: _(msg`Unable to change the language right now. Please try again.`),
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Language */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
            aria-label={_(msg`Change language`)}
            title={_(msg`Change language`)}
          >
            <Languages className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuLabel>{_(msg`Language`)}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {Object.entries(SUPPORTED_LANGUAGES).map(([code, lang]) => (
            <DropdownMenuItem
              key={code}
              disabled={isLoading}
              onClick={() => void setLanguage(code)}
            >
              <Globe className="mr-2 h-4 w-4 opacity-60" />
              <span className="flex-1">{lang.full}</span>
              {code === i18n.locale && (
                <span className="text-primary text-xs font-medium">●</span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Theme */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
            aria-label={_(msg`Change theme`)}
            title={_(msg`Change theme`)}
          >
            <Sun className="h-4 w-4 dark:hidden" />
            <Moon className="hidden h-4 w-4 dark:block" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuLabel>{_(msg`Theme`)}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {themes.map((t) => (
            <DropdownMenuItem key={String(t.theme)} onClick={() => setTheme(t.theme)}>
              <t.icon className="mr-2 h-4 w-4 opacity-60" />
              {_(t.label)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};
