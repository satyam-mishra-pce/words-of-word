import { useEffect, useRef } from 'react';
import {
  classifyAcceptedSound,
  classifyNoticeSound,
  classifyRejectedSound,
  playGameSound
} from '../services/gameAudio';
import type { SoundBus } from './soundBus';

/**
 * THE single source of truth mapping game events -> sounds. Both the multiplayer
 * room and the single-player daily surface push semantic events onto the shared
 * SoundBus; this hook is the only place that decides which sound plays, including
 * the timer cadence (a calm tick each second through the warning window, then the
 * urgent tick for the final 3-2-1) and accepted/rejected classification. Add or
 * change a sound here once and every surface gets it.
 */
export function useGameSounds(bus: SoundBus): void {
  // Per-round dedup so a repeated timeUpdate/interval tick at the same second
  // (or a Lightning time gain) never replays a tick already heard.
  const playedTimerRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsubscribe = bus.subscribe((event) => {
      switch (event.type) {
        case 'roundStart':
          playGameSound('roundStart');
          break;
        case 'roundEnd':
          playGameSound('roundEnd');
          break;
        case 'wordAccepted':
          playGameSound(
            event.message !== undefined
              ? classifyAcceptedSound(event.message, Boolean(event.lightning))
              : 'wordAccepted'
          );
          break;
        case 'wordRejected':
          playGameSound(
            event.message !== undefined
              ? classifyRejectedSound(event.message, event.penalty)
              : 'wordRejected'
          );
          break;
        case 'timerTick': {
          const { secondsLeft, warnAt, roundKey } = event;
          if (secondsLeft > 3 && secondsLeft <= warnAt) {
            const key = `${roundKey}:warning:${secondsLeft}`;
            if (!playedTimerRef.current.has(key)) {
              playedTimerRef.current.add(key);
              playGameSound('timerWarning');
            }
          } else if (secondsLeft > 0 && secondsLeft <= 3) {
            const key = `${roundKey}:tick:${secondsLeft}`;
            if (!playedTimerRef.current.has(key)) {
              playedTimerRef.current.add(key);
              playGameSound('timerTick');
            }
          }
          break;
        }
        case 'notice': {
          const sound = classifyNoticeSound(event.message);
          if (sound) playGameSound(sound);
          break;
        }
        case 'play':
          playGameSound(event.sound);
          break;
      }
    });
    return unsubscribe;
  }, [bus]);
}
