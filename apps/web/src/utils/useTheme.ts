import { useEffect, useState } from 'react';
import { STORAGE_KEYS, readStoredValue, writeStoredValue } from '../services/storage';

export type Theme = 'dark' | 'light';

function getInitialTheme(): Theme {
  const stored = readStoredValue(STORAGE_KEYS.theme) as Theme | null;
  if (stored === 'dark' || stored === 'light') return stored;
  if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
    } else {
      root.removeAttribute('data-theme');
    }
    writeStoredValue(STORAGE_KEYS.theme, theme);
    document.dispatchEvent(new CustomEvent('wow:theme-change', { detail: { theme } }));
  }, [theme]);

  const toggle = (): void => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return { theme, toggle };
}
