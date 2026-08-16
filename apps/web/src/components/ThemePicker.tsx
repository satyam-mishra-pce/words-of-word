import type { CSSProperties, MouseEvent } from 'react';
import { THEME_OPTIONS, themeMode, type Theme, useTheme } from '../utils/useTheme';
import { trackFeatureUsage } from '../services/aggregateAnalytics';

function getThemeOrigin(event: MouseEvent<HTMLButtonElement>): { x: number; y: number } {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: bounds.left + (bounds.width / 2),
    y: bounds.top + (bounds.height / 2)
  };
}

export function swatchStyle(color: string, mode: 'dark' | 'light'): CSSProperties {
  return {
    '--sw-accent': color,
    '--sw-base': mode === 'dark' ? '#111111' : '#ffffff'
  } as CSSProperties;
}

/**
 * Footer quick-picker: the six accents in the *current* mode (never more than
 * six; four on phones via CSS). The full 12-theme dark/light grid lives in
 * Settings → Appearance.
 */
export function ThemePicker(): JSX.Element {
  const { theme, setTheme } = useTheme();
  const mode = themeMode(theme);
  const options = THEME_OPTIONS.filter((option) => option.mode === mode);

  function selectTheme(event: MouseEvent<HTMLButtonElement>, nextTheme: Theme): void {
    if (nextTheme !== theme) trackFeatureUsage('theme_changed');
    setTheme(nextTheme, getThemeOrigin(event));
  }

  return (
    <div className="theme-picker" role="group" aria-label="Choose a color theme">
      {options.map((option) => {
        const isActive = option.value === theme;
        return (
          <button
            key={option.value}
            aria-label={`${option.label} theme${isActive ? ', selected' : ''}`}
            aria-pressed={isActive}
            className="theme-swatch"
            data-theme-option={option.value}
            onClick={(event) => selectTheme(event, option.value)}
            style={swatchStyle(option.color, option.mode)}
            title={option.label}
            type="button"
          />
        );
      })}
    </div>
  );
}
