import type { FormEvent, ReactNode, Ref } from 'react';
import { Badge, Button, Input, Label, Progress } from '../components/ui';
import { WordDefinitionSheet } from '../components/WordDefinitionSheet';
import { useGameSounds } from './useGameSounds';
import type { SoundBus } from './soundBus';
import type { WordDefinitionsApi } from './useWordDefinitions';

export interface GameRoundTimer {
  progress: number;
  state: 'ok' | 'warn' | 'urgent';
  label: string;
  urgent: boolean;
  ariaLabel?: string;
  ariaValueText?: string;
}

export interface GameRoundInput {
  ref?: Ref<HTMLInputElement>;
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  disabled?: boolean;
  placeholder?: string;
  feedback?: 'success' | 'error' | null;
  submitDisabled?: boolean;
  submitLabel?: string;
  formClassName?: string;
}

export interface GameRoundWords {
  title?: string;
  count?: ReactNode;
  items: string[];
  /** Override chip rendering (e.g. scored badges). Defaults to a definition-opening chip. */
  renderWord?: (word: string) => ReactNode;
  emptyLabel?: string;
  extra?: ReactNode;
  className?: string;
}

export interface GameRoundProps {
  /** Shared sound stream; every surface pushes semantic events, sounds map in one place. */
  soundBus: SoundBus;
  /** Shared definition behaviour (cache, sheet, prefetch) — the sheet is rendered here. */
  definitions: WordDefinitionsApi;

  notice?: string;

  // Source word card
  sourceWordLabel?: string;
  sourceWord?: string;
  sourceWaitingLabel?: string;
  sourceDefinition?: string;
  renderSourceWord?: (word: string) => ReactNode;
  sourceExtra?: ReactNode;

  // Timer
  timer?: GameRoundTimer;

  // Word entry
  input?: GameRoundInput;
  /** Fully custom form (e.g. betting) replacing the default word entry. */
  form?: ReactNode;

  // Accepted words
  words?: GameRoundWords;

  // Slots for surface-specific interleaving (round strip, bingo board, results…)
  afterTimer?: ReactNode;
  beforeWords?: ReactNode;
  afterWords?: ReactNode;
  children?: ReactNode;
}

/**
 * The one shared game round surface. Daily and the multiplayer room both render
 * this, so any cross-cutting round feature (sounds, definitions on chips, timer
 * behaviour, word-entry feedback) is built once here and appears on every surface.
 * Surface-specific chrome is passed via slots; the shared core cannot diverge.
 */
export function GameRound(props: GameRoundProps): JSX.Element {
  const { soundBus, definitions } = props;
  useGameSounds(soundBus);

  const renderChip = (word: string): ReactNode => {
    if (props.words?.renderWord) return props.words.renderWord(word);
    return (
      <button
        key={word}
        type="button"
        className="accepted-word-button"
        title={`View definition of ${word}`}
        aria-label={`${word}. View definition`}
        onClick={() => { void definitions.openWordDefinition(word); }}
      >
        <Badge variant="word">{word}</Badge>
      </button>
    );
  };

  return (
    <>
      <div className={`stage-notice-bar${props.notice ? ' active' : ''}`} aria-live="polite">{props.notice}</div>

      <div className="current-word-card">
        {props.sourceWordLabel && <span className="current-word-label">{props.sourceWordLabel}</span>}
        {props.sourceWord
          ? (props.renderSourceWord
              ? props.renderSourceWord(props.sourceWord)
              : (
                <button
                  type="button"
                  className="current-word-text current-word-text--interactive"
                  title={`View definition of ${props.sourceWord}`}
                  aria-label={`${props.sourceWord}. View definition`}
                  onClick={() => { if (props.sourceWord) void definitions.openWordDefinition(props.sourceWord); }}
                >
                  {props.sourceWord}
                </button>
              ))
          : props.sourceWaitingLabel
            ? <span className="current-word-waiting">{props.sourceWaitingLabel}</span>
            : null}
        {props.sourceDefinition && props.sourceWord && (
          <button
            type="button"
            className="current-word-definition current-word-definition--interactive"
            title="View full definition"
            aria-label={`View full definition of ${props.sourceWord}`}
            onClick={() => { if (props.sourceWord) void definitions.openWordDefinition(props.sourceWord); }}
          >
            {props.sourceDefinition}
          </button>
        )}
        {props.sourceExtra}
      </div>

      {props.timer && (
        <div className={`timer-section${props.timer.urgent ? ' urgent' : ''}`}>
          <div className="round-timer">
            <Progress
              value={props.timer.progress}
              state={props.timer.state}
              aria-label={props.timer.ariaLabel ?? 'Round time remaining'}
              aria-valuetext={props.timer.ariaValueText ?? `${props.timer.label} remaining`}
            />
            <span className="round-timer__label" aria-hidden="true">{props.timer.label}</span>
          </div>
        </div>
      )}

      {props.afterTimer}

      {props.form ?? (props.input && (
        <form className={props.input.formClassName ?? 'word-form'} onSubmit={props.input.onSubmit}>
          <div>
            {props.input.label && <Label htmlFor={props.input.id}>{props.input.label}</Label>}
            <Input
              ref={props.input.ref}
              id={props.input.id}
              value={props.input.value}
              onChange={(e) => props.input?.onChange(e.currentTarget.value)}
              onFocus={props.input.onFocus}
              onBlur={props.input.onBlur}
              placeholder={props.input.placeholder}
              disabled={props.input.disabled}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="done"
              data-feedback={props.input.feedback ?? undefined}
            />
          </div>
          <Button variant="primary" type="submit" disabled={props.input.submitDisabled}>
            {props.input.submitLabel ?? 'Go'}
          </Button>
        </form>
      ))}

      {props.beforeWords}

      {props.words && (
        <div className={props.words.className ?? 'words-card'}>
          <div className="words-header">
            <h3>{props.words.title ?? 'Your Words'}</h3>
            <span className="words-count">{props.words.count ?? `${props.words.items.length} found`}</span>
          </div>
          <div className="word-chip-list">
            {props.words.items.length > 0
              ? props.words.items.map((word) => renderChip(word))
              : <em>{props.words.emptyLabel ?? 'No words yet.'}</em>}
          </div>
          {props.words.extra}
        </div>
      )}

      {props.afterWords}
      {props.children}

      <WordDefinitionSheet {...definitions.sheetProps} />
    </>
  );
}
