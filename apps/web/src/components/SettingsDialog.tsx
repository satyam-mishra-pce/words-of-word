import { useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog } from './ui';
import { THEME_OPTIONS, useTheme, type Theme } from '../utils/useTheme';
import { swatchStyle } from './ThemePicker';
import { getSoundPreferences, setSoundPreferences } from '../services/gameAudio';
import { loadBackgroundLetters, setBackgroundLetters } from '../services/uiPreferences';

const TABS = ['Appearance', 'Sound', 'About'] as const;
type Tab = (typeof TABS)[number];

const DARK_THEMES = THEME_OPTIONS.filter((option) => option.mode === 'dark');
const LIGHT_THEMES = THEME_OPTIONS.filter((option) => option.mode === 'light');

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The scalable Settings surface (modal on desktop, sheet-like on phone). Only
 * Appearance + About are live today; Sound / Gameplay tabs slot in later without
 * touching callers.
 */
export function SettingsDialog({ open, onClose }: SettingsDialogProps): JSX.Element {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('Appearance');
  const { theme, setTheme } = useTheme();
  const [sound, setSound] = useState(getSoundPreferences());
  const [bgLetters, setBgLettersState] = useState(loadBackgroundLetters());

  function updateSound(next: { enabled?: boolean; volume?: number }): void {
    const merged = { ...sound, ...next };
    setSound(merged);
    setSoundPreferences(merged);
  }

  function toggleBackgroundLetters(on: boolean): void {
    setBgLettersState(on);
    setBackgroundLetters(on);
  }

  function pickTheme(event: MouseEvent<HTMLButtonElement>, value: Theme): void {
    setTheme(value, { x: event.clientX, y: event.clientY });
  }

  function renderThemeRow(options: ReadonlyArray<(typeof THEME_OPTIONS)[number]>): JSX.Element {
    return (
      <div className="theme-grid">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`theme-thumb${option.value === theme ? ' is-active' : ''}`}
            style={swatchStyle(option.color, option.mode)}
            aria-pressed={option.value === theme}
            onClick={(event) => pickTheme(event, option.value)}
          >
            <span className="theme-thumb__chip" aria-hidden="true" />
            <span className="theme-thumb__label">{option.label}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} size="lg" ariaLabel="Settings">
      <div className="settings">
        <p className="eyebrow">settings</p>
        <nav className="settings__tabs" role="tablist">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              className={`settings__tab${tab === name ? ' is-active' : ''}`}
              onClick={() => setTab(name)}
            >
              {name}
            </button>
          ))}
        </nav>

        <div className="settings__body">
          {tab === 'Appearance' && (
            <>
              <h3 className="settings__section">Dark</h3>
              {renderThemeRow(DARK_THEMES)}
              <h3 className="settings__section">Light</h3>
              {renderThemeRow(LIGHT_THEMES)}

              <h3 className="settings__section">Interface</h3>
              <label className="settings__row">
                <span>Background letters</span>
                <input type="checkbox" className="settings__switch" checked={bgLetters} onChange={(event) => toggleBackgroundLetters(event.currentTarget.checked)} />
              </label>
            </>
          )}

          {tab === 'Sound' && (
            <>
              <label className="settings__row">
                <span>Game sounds</span>
                <input type="checkbox" className="settings__switch" checked={sound.enabled} onChange={(event) => updateSound({ enabled: event.currentTarget.checked })} />
              </label>
              <label className="settings__row settings__row--stack">
                <span>Volume</span>
                <input
                  type="range"
                  className="settings__slider"
                  min={0}
                  max={100}
                  value={Math.round(sound.volume * 100)}
                  disabled={!sound.enabled}
                  onChange={(event) => updateSound({ volume: Number(event.currentTarget.value) / 100 })}
                />
              </label>
              <p className="settings__hint">Timer ticks, word accepts/rejects, and round cues.</p>
            </>
          )}

          {tab === 'About' && (
            <div className="settings__about">
              <p>
                <strong>Words of Word</strong> — one enormous word, hundreds hiding inside it.
                Race to find them all before the clock hits zero.
              </p>
              <div className="settings__links">
                <button type="button" className="settings__link" onClick={() => { onClose(); navigate('/about'); }}>
                  How to play &amp; game modes →
                </button>
                <button type="button" className="settings__link" onClick={() => { onClose(); navigate('/leaderboard'); }}>
                  Leaderboard →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
