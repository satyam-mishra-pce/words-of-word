import { useEffect, useRef } from 'react';
import type { PlayerAvatar } from '@wow/shared';
import {
  renderPlayerAvatar,
  renderPlayerAvatarPart,
  type PlayerAvatarCharacterSet,
  type PlayerAvatarPart
} from '../services/playerAvatar';

interface PlayerAvatarSpriteProps {
  avatar: PlayerAvatar;
  className?: string;
  title?: string;
}

/** A locally-rendered, atlas-composited Pipoya character. */
export function PlayerAvatarSprite({ avatar, className, title }: PlayerAvatarSpriteProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let active = true;
    void renderPlayerAvatar(canvas, avatar).then((rendered) => {
      if (!active || rendered) return;
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    });

    return () => { active = false; };
  }, [avatar]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width="32"
      height="32"
      title={title}
      aria-hidden="true"
    />
  );
}

interface PlayerAvatarPartSpriteProps {
  characterSet: PlayerAvatarCharacterSet;
  part: PlayerAvatarPart;
  value: number;
  className?: string;
}

/** A single Pipoya layer for the character-picker grid. */
export function PlayerAvatarPartSprite({ characterSet, part, value, className }: PlayerAvatarPartSpriteProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let active = true;
    void renderPlayerAvatarPart(canvas, characterSet, part, value).then((rendered) => {
      if (!active || rendered) return;
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    });

    return () => { active = false; };
  }, [characterSet, part, value]);

  return <canvas ref={canvasRef} className={className} width="32" height="32" aria-hidden="true" />;
}
