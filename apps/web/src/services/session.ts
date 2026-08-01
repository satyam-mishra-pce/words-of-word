import { DEFAULT_PLAYER_AVATAR, PlayerAvatarSchema, type PlayerAvatar } from '@wow/shared';
import { STORAGE_KEYS, readStoredValue, writeStoredValue } from './storage';

const STARTER_NAMES = [
  'Lexi Lantern',
  'Word Warden',
  'Vowel Voyager',
  'Quiet Quill',
  'Letter Lark',
  'Anagram Ace',
  'Puzzle Pilot',
  'Scramble Sage',
  'Cipher Sparrow',
  'Rhyme Ranger'
];

function randomStarterName(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    return STARTER_NAMES[(random[0] ?? 0) % STARTER_NAMES.length] ?? 'Word Warden';
  }

  return STARTER_NAMES[Math.floor(Math.random() * STARTER_NAMES.length)] ?? 'Word Warden';
}

export function saveUsername(username: string): void {
  writeStoredValue(STORAGE_KEYS.username, username.trim());
}

/** Give first-time players a friendly, editable name immediately. */
export function loadUsername(): string {
  const storedUsername = readStoredValue(STORAGE_KEYS.username);
  if (storedUsername) return storedUsername;

  const generatedUsername = randomStarterName();
  saveUsername(generatedUsername);
  return generatedUsername;
}

export function savePlayerAvatar(avatar: PlayerAvatar): void {
  const parsed = PlayerAvatarSchema.safeParse(avatar);
  if (!parsed.success) return;
  writeStoredValue(STORAGE_KEYS.avatar, JSON.stringify(parsed.data));
}

export function loadPlayerAvatar(): PlayerAvatar {
  const storedAvatar = readStoredValue(STORAGE_KEYS.avatar);

  if (storedAvatar) {
    try {
      const parsed = PlayerAvatarSchema.safeParse(JSON.parse(storedAvatar));
      if (parsed.success) return parsed.data;
    } catch {
      // Fall through to a safe default if an old or malformed local value exists.
    }
  }

  // Replace pre-Pipoya recipes once, so future room payloads use the new engine.
  const defaultAvatar = { ...DEFAULT_PLAYER_AVATAR };
  savePlayerAvatar(defaultAvatar);
  return defaultAvatar;
}
