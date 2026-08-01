import { STORAGE_KEYS, readStoredValue, writeStoredValue } from './storage';

export function saveUsername(username: string): void {
  writeStoredValue(STORAGE_KEYS.username, username.trim());
}

export function loadUsername(): string {
  return readStoredValue(STORAGE_KEYS.username) ?? '';
}
