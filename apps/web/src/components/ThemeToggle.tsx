import { useTheme } from '../utils/useTheme';

export function ThemeToggle(): JSX.Element {
  const { theme, toggle } = useTheme();
  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      title={`switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? 'light' : 'dark'}
    </button>
  );
}
