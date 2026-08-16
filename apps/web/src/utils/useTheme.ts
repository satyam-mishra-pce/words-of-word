import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { STORAGE_KEYS, readStoredValue, writeStoredValue } from '../services/storage';

export type ThemeMode = 'dark' | 'light';

/**
 * Twelve themes: six accents on a dark base, and their light siblings. Each
 * theme only needs its accent (the diagonal-swatch top colour) and its mode
 * (which base the swatch/bottom depicts). The CSS in styles.css maps each value
 * to the accent (and, for light themes, an inverted base palette).
 */
export const THEME_OPTIONS = [
  { value: 'amber', label: 'Amber', color: '#e2b714', mode: 'dark' },
  { value: 'sky', label: 'Sky', color: '#62c8ee', mode: 'dark' },
  { value: 'lilac', label: 'Lilac', color: '#dba9f5', mode: 'dark' },
  { value: 'mint', label: 'Mint', color: '#36d39e', mode: 'dark' },
  { value: 'rose', label: 'Rose', color: '#f4a7ad', mode: 'dark' },
  { value: 'apricot', label: 'Apricot', color: '#f5ad5c', mode: 'dark' },
  { value: 'honey', label: 'Honey', color: '#a67c00', mode: 'light' },
  { value: 'frost', label: 'Frost', color: '#1c8fb8', mode: 'light' },
  { value: 'orchid', label: 'Orchid', color: '#9750c8', mode: 'light' },
  { value: 'meadow', label: 'Meadow', color: '#12946b', mode: 'light' },
  { value: 'blush', label: 'Blush', color: '#d1566e', mode: 'light' },
  { value: 'peach', label: 'Peach', color: '#d1791d', mode: 'light' }
] as const;

export type Theme = (typeof THEME_OPTIONS)[number]['value'];

export function themeMode(theme: Theme): ThemeMode {
  return THEME_OPTIONS.find((option) => option.value === theme)?.mode ?? 'dark';
}

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
  const themeRequestId = useRef(0);

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

    const requestId = ++themeRequestId.current;
    const isCurrentRequest = (): boolean => themeRequestId.current === requestId;
    currentTheme.current = nextTheme;
    clearRippleOrigin();

    let hasUpdated = false;
    let transitionTimeout: number | undefined;
    const updateTheme = (): void => {
      if (hasUpdated || !isCurrentRequest()) return;

      hasUpdated = true;
      if (transitionTimeout !== undefined) window.clearTimeout(transitionTimeout);
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
      if (isCurrentRequest()) showFallbackRipple(origin);
      return;
    }

    setRippleOrigin(origin);
    // View Transitions normally invokes its callback on the next rendered frame.
    // If an implementation gets stuck before that point, do not leave the theme
    // selection inert; commit it with the lightweight ripple fallback instead.
    transitionTimeout = window.setTimeout(() => {
      if (hasUpdated || !isCurrentRequest()) return;

      clearRippleOrigin();
      updateTheme();
      showFallbackRipple(origin);
    }, 700);

    try {
      const transition = transitionDocument.startViewTransition(updateTheme);
      void transition.finished.then(
        () => {
          if (isCurrentRequest()) clearRippleOrigin();
        },
        () => {
          if (isCurrentRequest()) clearRippleOrigin();
        }
      );
    } catch {
      if (!isCurrentRequest()) return;

      clearRippleOrigin();
      updateTheme();
      showFallbackRipple(origin);
    }
  }, [commitTheme]);

  return { theme, setTheme };
}
