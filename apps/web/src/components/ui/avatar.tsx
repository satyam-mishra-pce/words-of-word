import { HTMLAttributes } from 'react';
import type { PlayerAvatar } from '@wow/shared';
import { PlayerAvatarSprite } from '../PlayerAvatarSprite';
import { cn } from '../../utils/cn';

export type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  name: string;
  /** A compact Pipoya recipe supplied by the player. Falls back to initials for legacy data. */
  avatar?: PlayerAvatar | undefined;
  colorIndex?: number;
  size?: AvatarSize;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0] ?? '';
  const last = parts.length >= 2 ? (parts[parts.length - 1] ?? '') : '';
  if (first && last) return (first.charAt(0) + last.charAt(0)).toUpperCase();
  return first.slice(0, 2).toUpperCase() || '?';
}

export function Avatar({ name, avatar, colorIndex = 0, size = 'md', className, ...props }: AvatarProps) {
  return (
    <div
      className={cn('ui-avatar', `ui-avatar-${size}`, `ui-avatar-${colorIndex % 6}`, avatar && 'ui-avatar--sprite', className)}
      title={name}
      aria-label={name}
      {...props}
    >
      {avatar ? <PlayerAvatarSprite className="ui-avatar__sprite" avatar={avatar} /> : getInitials(name)}
    </div>
  );
}
