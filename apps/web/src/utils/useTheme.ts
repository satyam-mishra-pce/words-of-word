import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem('wow-theme') as Theme | null;
    if (stored === 'dark' || stored === 'light') return stored;
    if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  } catch {
    // localStorage unavailable
  }
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
    try {
      localStorage.setItem('wow-theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const toggle = (): void => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return { theme, toggle };
}
