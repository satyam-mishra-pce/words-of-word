import type { GameSound } from '../services/gameAudio';

/**
 * The single semantic event stream that every game surface (multiplayer room,
 * single-player daily, and anything added later) emits into. All round -> sound
 * mapping lives in one place (useGameSounds), so a surface can never silently
 * ship without a sound another surface already has. Emit intent here; never call
 * playGameSound directly from a page.
 */
export type GameSoundEvent =
  | { type: 'roundStart' }
  | { type: 'roundEnd' }
  | { type: 'wordAccepted'; message?: string | undefined; lightning?: boolean | undefined }
  | { type: 'wordRejected'; message?: string | undefined; penalty?: number | undefined }
  | { type: 'timerTick'; secondsLeft: number; warnAt: number; roundKey: string | number }
  | { type: 'notice'; message: string }
  | { type: 'play'; sound: GameSound };

export type GameSoundListener = (event: GameSoundEvent) => void;

export interface SoundBus {
  emit(event: GameSoundEvent): void;
  /** Convenience for surface-specific one-off sounds (bomb, betting, victory…). */
  play(sound: GameSound): void;
  subscribe(listener: GameSoundListener): () => void;
}

export function createSoundBus(): SoundBus {
  const listeners = new Set<GameSoundListener>();
  return {
    emit(event) {
      for (const listener of listeners) listener(event);
    },
    play(sound) {
      for (const listener of listeners) listener({ type: 'play', sound });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
