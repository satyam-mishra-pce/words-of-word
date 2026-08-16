import { readStoredValue, writeStoredValue } from './storage';

/** Fired when a cosmetic UI preference changes, so open surfaces can react live. */
export const UI_PREFS_EVENT = 'wow:ui-prefs-change';

const BG_LETTERS_KEY = 'wow.bg-letters';

/** The floating W·O·R·D·S letters behind the home hero (on by default). */
export function loadBackgroundLetters(): boolean {
  return readStoredValue(BG_LETTERS_KEY) !== 'off';
}

export function setBackgroundLetters(on: boolean): void {
  writeStoredValue(BG_LETTERS_KEY, on ? 'on' : 'off');
  window.dispatchEvent(new CustomEvent(UI_PREFS_EVENT));
}
