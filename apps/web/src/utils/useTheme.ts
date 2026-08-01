import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { STORAGE_KEYS, readStoredValue, writeStoredValue } from '../services/storage';

export const THEME_OPTIONS = [
  { value: 'amber', label: 'Amber', color: '#e2b714' },
  { value: 'sky', label: 'Sky', color: '#62c8ee' },
  { value: 'lilac', label: 'Lilac', color: '#dba9f5' },
  { value: 'mint', label: 'Mint', color: '#36d39e' },
  { value: 'rose', label: 'Rose', color: '#f4a7ad' },
  { value: 'apricot', label: 'Apricot', color: '#f5ad5c' }
] as const;

export type Theme = (typeof THEME_OPTIONS)[number]['value'];

interface ThemeChangeOrigin {
  x: number;
  y: number;
}

interface ThemeViewTransition {
  finished: Promise<void>;
}

type ThemeTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => ThemeViewTransition;
};

const themeValues = new Set<string>(THEME_OPTIONS.map(({ value }) => value));

function normaliseTheme(value: string | null): Theme {
  if (value && themeValues.has(value)) return value as Theme;

  // Keep the previous two-option preference meaningful after the migration.
  return value === 'light' ? 'apricot' : 'amber';
}

function getInitialTheme(): Theme {
  return normaliseTheme(readStoredValue(STORAGE_KEYS.theme));
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  writeStoredValue(STORAGE_KEYS.theme, theme);
  document.dispatchEvent(new CustomEvent('wow:theme-change', { detail: { theme } }));
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function getRippleRadius(origin: ThemeChangeOrigin): number {
  const farthestX = Math.max(origin.x, window.innerWidth - origin.x);
  const farthestY = Math.max(origin.y, window.innerHeight - origin.y);
  return Math.hypot(farthestX, farthestY);
}

function setRippleOrigin(origin: ThemeChangeOrigin): void {
  const root = document.documentElement;

  root.style.setProperty('--theme-ripple-x', `${origin.x}px`);
  root.style.setProperty('--theme-ripple-y', `${origin.y}px`);
  root.style.setProperty('--theme-ripple-radius', `${getRippleRadius(origin)}px`);
}

function clearRippleOrigin(): void {
  const root = document.documentElement;
  root.style.removeProperty('--theme-ripple-x');
  root.style.removeProperty('--theme-ripple-y');
  root.style.removeProperty('--theme-ripple-radius');
}

function showFallbackRipple(origin: ThemeChangeOrigin): void {
  const ripple = document.createElement('span');
  const diameter = 20;

  ripple.className = 'theme-ripple-fallback';
  ripple.style.setProperty('--theme-ripple-x', `${origin.x}px`);
  ripple.style.setProperty('--theme-ripple-y', `${origin.y}px`);
  ripple.style.setProperty('--theme-ripple-scale', `${(getRippleRadius(origin) * 2) / diameter}`);
  ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  document.body.append(ripple);
  window.setTimeout(() => ripple.remove(), 700);
}

export function useTheme(): {
  theme: Theme;
  setTheme: (theme: Theme, origin?: ThemeChangeOrigin) => void;
} {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);
  const currentTheme = useRef(theme);
  const committedTheme = useRef<Theme>();
  const rippleId = useRef(0);

  const commitTheme = useCallback((nextTheme: Theme): void => {
    if (committedTheme.current === nextTheme) return;

    applyTheme(nextTheme);
    committedTheme.current = nextTheme;
  }, []);

  useEffect(() => {
    currentTheme.current = theme;
    commitTheme(theme);
  }, [commitTheme, theme]);

  const setTheme = useCallback((nextTheme: Theme, origin?: ThemeChangeOrigin): void => {
    if (nextTheme === currentTheme.current) return;

    currentTheme.current = nextTheme;
    const updateTheme = (): void => {
      commitTheme(nextTheme);
      flushSync(() => setThemeState(nextTheme));
    };
    const transitionDocument = document as ThemeTransitionDocument;

    if (!origin || prefersReducedMotion()) {
      updateTheme();
      return;
    }

    if (!transitionDocument.startViewTransition) {
      updateTheme();
      showFallbackRipple(origin);
      return;
    }

    const currentRippleId = ++rippleId.current;
    setRippleOrigin(origin);

    try {
      const transition = transitionDocument.startViewTransition(updateTheme);
      void transition.finished.then(
        () => {
          if (rippleId.current === currentRippleId) clearRippleOrigin();
        },
        () => {
          if (rippleId.current === currentRippleId) clearRippleOrigin();
        }
      );
    } catch {
      clearRippleOrigin();
      updateTheme();
    }
  }, [commitTheme]);

  return { theme, setTheme };
}
