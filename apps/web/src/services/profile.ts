import { DEFAULT_PLAYER_AVATAR, PlayerAvatarSchema, type PlayerAvatar } from '@wow/shared';
import { supabase } from './supabase';
import { loadPlayerAvatar, loadUsername, savePlayerAvatar, saveUsername } from './session';

export interface Profile {
  id: string;
  username: string;
  avatar: PlayerAvatar;
}

interface ProfileRow {
  id: string;
  username: string | null;
  avatar: unknown;
}

function parseAvatar(value: unknown): PlayerAvatar | undefined {
  const parsed = PlayerAvatarSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function isMeaningfulAvatar(avatar: unknown): boolean {
  return Boolean(parseAvatar(avatar));
}

/** Fetch the signed-in user's profile row. Returns null when unavailable. */
export async function fetchProfile(userId: string): Promise<ProfileRow | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar')
    .eq('id', userId)
    .maybeSingle<ProfileRow>();
  if (error) {
    console.warn('Failed to fetch profile', error.message);
    return null;
  }
  return data;
}

/** Persist username/avatar changes to the signed-in user's profile row. */
export async function saveProfile(
  userId: string,
  fields: { username?: string; avatar?: PlayerAvatar }
): Promise<void> {
  if (!supabase) return;
  const payload: Record<string, unknown> = { id: userId };
  if (fields.username !== undefined) payload.username = fields.username.trim().slice(0, 20);
  if (fields.avatar !== undefined) payload.avatar = fields.avatar;

  const { error } = await supabase.from('profiles').upsert(payload, { onConflict: 'id' });
  if (error) console.warn('Failed to save profile', error.message);
}

/**
 * Reconcile local (anonymous) identity with the durable profile on sign-in.
 *
 * - First sign-in with an empty remote profile adopts the local name/avatar
 *   (so the player keeps the identity they already built).
 * - A returning device adopts the remote name/avatar (identity follows the
 *   account across devices) and writes it back to local storage.
 *
 * Returns the effective identity so callers can refresh their UI immediately.
 */
export async function syncProfileOnSignIn(userId: string): Promise<Profile> {
  const localUsername = loadUsername();
  const localAvatar = loadPlayerAvatar();

  const row = await fetchProfile(userId);

  const remoteUsername = row?.username?.trim() ?? '';
  const remoteAvatar = parseAvatar(row?.avatar);

  const username = remoteUsername || localUsername;
  const avatar = remoteAvatar ?? localAvatar;

  // Adopt the effective identity locally so anonymous surfaces stay in sync.
  if (username && username !== localUsername) saveUsername(username);
  if (remoteAvatar) savePlayerAvatar(remoteAvatar);

  // Backfill an empty remote profile from the local identity.
  const needsRemoteUsername = !remoteUsername && Boolean(username);
  const needsRemoteAvatar = !isMeaningfulAvatar(row?.avatar);
  if (row === null || needsRemoteUsername || needsRemoteAvatar) {
    await saveProfile(userId, {
      ...(needsRemoteUsername || row === null ? { username } : {}),
      ...(needsRemoteAvatar || row === null ? { avatar } : {})
    });
  }

  return { id: userId, username: username || '', avatar: avatar ?? { ...DEFAULT_PLAYER_AVATAR } };
}
