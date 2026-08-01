import type { CSSProperties, MouseEvent } from 'react';
import { THEME_OPTIONS, type Theme, useTheme } from '../utils/useTheme';

function getThemeOrigin(event: MouseEvent<HTMLButtonElement>): { x: number; y: number } {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: bounds.left + (bounds.width / 2),
    y: bounds.top + (bounds.height / 2)
  };
}

export function ThemePicker(): JSX.Element {
  const { theme, setTheme } = useTheme();

  function selectTheme(event: MouseEvent<HTMLButtonElement>, nextTheme: Theme): void {
    setTheme(nextTheme, getThemeOrigin(event));
  }

  return (
    <div className="theme-picker" role="group" aria-label="Choose a color theme">
      {THEME_OPTIONS.map((option) => {
        const isActive = option.value === theme;

        return (
          <button
            key={option.value}
            aria-label={`${option.label} theme${isActive ? ', selected' : ''}`}
            aria-pressed={isActive}
            className="theme-swatch"
            data-theme-option={option.value}
            onClick={(event) => selectTheme(event, option.value)}
            style={{ '--theme-swatch': option.color } as CSSProperties}
            title={option.label}
            type="button"
          />
        );
      })}
    </div>
  );
}
