import { useState } from 'react';
import { Button, Dialog, Label } from './ui';
import {
  getSoundPreferences,
  previewGameSound,
  setSoundPreferences,
  type GameSound,
  type SoundPreferences
} from '../services/gameAudio';

interface SoundLabDialogProps {
  open: boolean;
  onClose: () => void;
}

const PREVIEW_SOUNDS: Array<{ sound: GameSound; label: string; detail: string; bomb?: boolean }> = [
  { sound: 'bombSelf', label: '💣 Bomb', detail: 'Signature Busted effect', bomb: true },
  { sound: 'roundStart', label: 'Round start', detail: 'New round cue' },
  { sound: 'wordAccepted', label: 'Accepted', detail: 'Your valid word' },
  { sound: 'wordRejected', label: 'Rejected', detail: 'Invalid word' },
  { sound: 'timerTick', label: 'Final tick', detail: '3–2–1 warning' },
  { sound: 'victory', label: 'Victory', detail: 'You win the game' },
  { sound: 'bingoComplete', label: 'Bingo', detail: 'Full board complete' },
  { sound: 'lightningGain', label: 'Lightning +1', detail: 'Timer charged' }
];

export function SoundLabDialog({ open, onClose }: SoundLabDialogProps): JSX.Element {
  const [preferences, setPreferencesState] = useState<SoundPreferences>(getSoundPreferences);

  function updatePreferences(update: Partial<SoundPreferences>): SoundPreferences {
    const next = { ...preferences, ...update };
    setPreferencesState(next);
    setSoundPreferences(next);
    return next;
  }

  function toggleEnabled(): void {
    const next = updatePreferences({ enabled: !preferences.enabled });
    if (next.enabled) void previewGameSound('wordAccepted');
  }

  function preview(sound: GameSound): void {
    if (!preferences.enabled) return;
    void previewGameSound(sound);
  }

  return (
    <Dialog open={open} onClose={onClose} size="md" ariaLabel="Sound settings and preview" className="sound-lab-dialog">
      <div className="dialog-header">
        <p className="eyebrow">Sound</p>
        <h2>Game sound effects</h2>
        <p className="muted">Crunchy retro-pixel effects, generated inside the app. Tap any event to preview it.</p>
      </div>

      <div className="sound-lab-master">
        <div>
          <strong>Sound effects</strong>
          <span className="muted">{preferences.enabled ? 'On' : 'Muted'}</span>
        </div>
        <Button
          variant={preferences.enabled ? 'secondary' : 'primary'}
          size="sm"
          type="button"
          aria-pressed={preferences.enabled}
          onClick={toggleEnabled}
        >
          {preferences.enabled ? '🔊 Sound on' : '🔇 Turn on'}
        </Button>
      </div>

      <div className="sound-lab-volume">
        <Label htmlFor="sound-volume">Volume <span>{Math.round(preferences.volume * 100)}%</span></Label>
        <input
          id="sound-volume"
          type="range"
          min="0"
          max="100"
          step="5"
          value={Math.round(preferences.volume * 100)}
          onChange={(event) => updatePreferences({ volume: Number(event.currentTarget.value) / 100 })}
          onPointerUp={() => { if (preferences.enabled) void previewGameSound('wordAccepted'); }}
          aria-valuetext={`${Math.round(preferences.volume * 100)} percent`}
        />
      </div>

      <section className="sound-preview-section" aria-labelledby="sound-preview-title">
        <div className="sound-preview-heading">
          <div>
            <h3 id="sound-preview-title">Preview sounds</h3>
            <p className="muted">{preferences.enabled ? 'Tap any event to hear it.' : 'Turn sound on to preview.'}</p>
          </div>
        </div>
        <div className="sound-preview-grid">
          {PREVIEW_SOUNDS.map((item) => (
            <button
              key={item.sound}
              type="button"
              className={`sound-preview-button${item.bomb ? ' sound-preview-button--bomb' : ''}`}
              onClick={() => preview(item.sound)}
              disabled={!preferences.enabled}
            >
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="dialog-footer">
        <p className="muted">Your sound choice and volume are saved on this device.</p>
        <Button variant="primary" type="button" onClick={onClose}>Done</Button>
      </div>
    </Dialog>
  );
}
