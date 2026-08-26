// src/hooks/useTheme.ts
//
// Theme is one of the user preferences stored in `chart_settings.settings`
// for signed-in users. Anonymous users get an in-memory value (default
// 'light') that resets on refresh. See useUserPref for the persistence
// model.
//
// Side-effects this hook owns:
//   - Toggles the 'dark'/'light' classes on document.documentElement.
//     Several visualisation components (GaussianProcess, GARCH,
//     AttentionHeatmap) use a MutationObserver on this class as their
//     theme source, so the DOM mutation must keep happening.
//   - Sets the data-theme attribute (used by CSS variable theming).
//   - Dispatches a 'theme-change' CustomEvent so listeners that opted into
//     it can react. Previously this event was listened-for but never
//     dispatched anywhere; this fixes that latent dead code.
//
// Removed localStorage('theme') writes/reads. Persistence is
// now the DB row; anonymous users get an in-session value that resets on
// refresh. The two direct localStorage readers (Datasets, DatasetsDev) have
// been migrated to read the DOM class instead.

import { useEffect } from 'react';
import { useUserPref } from './useUserPref';

type Theme = 'dark' | 'light';

export function useTheme(): [Theme, () => void] {
  // TERMINAL PORT: the default is the CURRENT html class, not 'light'. The
  // shell owns the theme (header toggle + localStorage 'lset-theme', replayed
  // by index.html's boot script); with the site's hardcoded 'light' default,
  // merely mounting a useTheme consumer (RightToolbar inside the manual
  // backtester) would strip the dark class and flash the whole shell white.
  const domTheme: Theme = typeof document !== 'undefined' &&
    document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  const [theme, setTheme] = useUserPref<Theme>('preferences.theme', domTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    // Keep the shell's persisted choice in sync when a ported in-page toggle
    // (RightToolbar's sun/moon) flips the theme, so the next launch agrees.
    try { localStorage.setItem('lset-theme', theme); } catch { /* storage off */ }

    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }

    window.dispatchEvent(new CustomEvent('theme-change', { detail: theme }));
  }, [theme]);

  // Programmatic theme overrides via window.dispatchEvent('theme-change').
  useEffect(() => {
    const handle = (e: Event) => {
      const next = (e as CustomEvent).detail as Theme;
      if ((next === 'dark' || next === 'light') && next !== theme) {
        setTheme(next);
      }
    };
    window.addEventListener('theme-change', handle);
    return () => window.removeEventListener('theme-change', handle);
  }, [theme, setTheme]);

  const toggleTheme = () => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));

  return [theme, toggleTheme];
}
