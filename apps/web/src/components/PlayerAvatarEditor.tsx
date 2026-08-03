import { useMemo, useState } from 'react';
import type { PlayerAvatar } from '@wow/shared';
import { Avatar, Button, Dialog } from './ui';
import { PlayerAvatarPartSprite } from './PlayerAvatarSprite';
import {
  getPlayerAvatarPartOptions,
  isOptionalPlayerAvatarPart,
  PLAYER_AVATAR_CHARACTER_SETS,
  PLAYER_AVATAR_PARTS,
  randomizePlayerAvatar,
  type PlayerAvatarPart
} from '../services/playerAvatar';

interface PlayerAvatarEditorProps {
  avatar: PlayerAvatar;
  name: string;
  open: boolean;
  onClose: () => void;
  onChange: (avatar: PlayerAvatar) => void;
}

function SpriteChoiceGrid({
  part,
  avatar,
  onChange
}: {
  part: PlayerAvatarPart;
  avatar: PlayerAvatar;
  onChange: (value: number) => void;
}): JSX.Element | null {
  const options = getPlayerAvatarPartOptions(avatar.characterSet, part);
  if (!options.length) return null;

  const values = isOptionalPlayerAvatarPart(part) ? [0, ...options] : options;
  const label = PLAYER_AVATAR_PARTS.find((item) => item.value === part)?.label ?? part;

  return (
    <div className="sprite-choice-grid" role="tabpanel" aria-label={`${label} choices`}>
      {values.map((value) => {
        const selected = avatar[part] === value;
        return (
          <button
            key={value}
            type="button"
            className={`sprite-choice${selected ? ' sprite-choice--selected' : ''}`}
            onClick={() => onChange(value)}
            aria-label={value ? `Use ${label.toLowerCase()} option ${value}` : `Remove ${label.toLowerCase()}`}
            aria-pressed={selected}
          >
            {value ? (
              <PlayerAvatarPartSprite
                className="sprite-choice__part"
                characterSet={avatar.characterSet}
                part={part}
                value={value}
              />
            ) : (
              <span className="sprite-choice__none" aria-hidden="true">∅</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function PlayerAvatarEditor({ avatar, name, open, onClose, onChange }: PlayerAvatarEditorProps): JSX.Element {
  const playerName = name.trim() || 'Player';
  const [activePart, setActivePart] = useState<PlayerAvatarPart>('skin');
  const visibleParts = useMemo(
    () => PLAYER_AVATAR_PARTS.filter((part) => getPlayerAvatarPartOptions(avatar.characterSet, part.value).length > 0),
    [avatar.characterSet]
  );
  const selectedPart = visibleParts.some((part) => part.value === activePart)
    ? activePart
    : (visibleParts[0]?.value ?? 'skin');

  function update(part: PlayerAvatarPart, value: number): void {
    onChange({ ...avatar, [part]: value } as PlayerAvatar);
  }

  function chooseCharacterSet(characterSet: PlayerAvatar['characterSet']): void {
    setActivePart('skin');
    onChange(randomizePlayerAvatar(characterSet));
  }

  return (
    <Dialog open={open} onClose={onClose} size="lg" ariaLabel="Customize your player character" className="avatar-editor-dialog">
      <div className="avatar-editor__hero">
        <div className="avatar-editor__preview" aria-hidden="true">
          <Avatar name={playerName} avatar={avatar} size="lg" />
        </div>
        <div>
          <p className="eyebrow">Player character</p>
          <h1>your character.</h1>
          <p>Choose a character type, then pick a tab to change any part.</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="avatar-editor__shuffle" onClick={() => onChange(randomizePlayerAvatar(avatar.characterSet))}>
          ↻ Surprise me
        </Button>
      </div>

      <div className="avatar-editor__controls">
        <div className="avatar-editor__type-picker" aria-label="Character type">
          {PLAYER_AVATAR_CHARACTER_SETS.map((option) => {
            const selected = option.value === avatar.characterSet;
            const preview = selected ? avatar : randomizePlayerAvatar(option.value);
            return (
              <button
                key={option.value}
                type="button"
                className={`sprite-choice${selected ? ' sprite-choice--selected' : ''}`}
                onClick={() => chooseCharacterSet(option.value)}
                aria-pressed={selected}
              >
                <Avatar name={playerName} avatar={preview} size="sm" />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>

        <div className="avatar-editor__tabs" role="tablist" aria-label="Character customization">
          {visibleParts.map((part) => (
            <button
              key={part.value}
              type="button"
              role="tab"
              className={selectedPart === part.value ? 'avatar-editor__tab avatar-editor__tab--active' : 'avatar-editor__tab'}
              aria-selected={selectedPart === part.value}
              onClick={() => setActivePart(part.value)}
            >
              {part.label}
            </button>
          ))}
        </div>

        <SpriteChoiceGrid
          part={selectedPart}
          avatar={avatar}
          onChange={(value) => update(selectedPart, value)}
        />
      </div>

      <div className="avatar-editor__footer">
        <p>Pipoya character layers are composed locally from the same sprite-atlas system used by Simocracy.</p>
        <Button type="button" variant="primary" onClick={onClose}>Done</Button>
      </div>
    </Dialog>
  );
}
