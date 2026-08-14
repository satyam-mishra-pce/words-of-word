import { useEffect, useMemo, useRef } from 'react';
import type { DictionaryEntry, DictionaryPartOfSpeech, DictionarySense } from '@wow/shared';
import { Button, Spinner } from './ui';

interface WordDefinitionSheetProps {
  word: string | undefined;
  entry: DictionaryEntry | undefined;
  loading: boolean;
  error: string;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');
const POS_LABELS: Record<DictionaryPartOfSpeech, string> = {
  noun: 'noun', verb: 'verb', adjective: 'adjective', adverb: 'adverb', other: 'other', unknown: 'meaning'
};

export function partOfSpeechLabel(pos: DictionaryPartOfSpeech): string { return POS_LABELS[pos]; }
export function groupDictionarySenses(senses: readonly DictionarySense[]): Array<{ partOfSpeech: DictionaryPartOfSpeech; senses: DictionarySense[] }> {
  const groups = new Map<DictionaryPartOfSpeech, DictionarySense[]>();
  for (const sense of senses) groups.set(sense.partOfSpeech, [...(groups.get(sense.partOfSpeech) ?? []), sense]);
  return Array.from(groups, ([partOfSpeech, groupedSenses]) => ({ partOfSpeech, senses: groupedSenses }));
}
function focusableElements(sheet: HTMLElement): HTMLElement[] {
  return Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
}

export function WordDefinitionSheet({ word, entry, loading, error, onClose }: WordDefinitionSheetProps): JSX.Element | null {
  const groups = useMemo(() => groupDictionarySenses(entry?.senses ?? []), [entry]);
  const sheetRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!word) return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => sheet.focus());
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = focusableElements(sheet);
      if (focusable.length === 0) { event.preventDefault(); sheet.focus(); return; }
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;
      if (event.shiftKey && (document.activeElement === first || !sheet.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === sheet || !sheet.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown, true);
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
  }, [word]);
  if (!word) return null;

  return (
    <div className="definition-sheet-backdrop" onClick={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section ref={sheetRef} className="definition-sheet" role="dialog" aria-modal="true" aria-labelledby="definition-sheet-title" tabIndex={-1}>
        <div className="definition-sheet-handle" aria-hidden="true" />
        <button type="button" className="definition-sheet-close" onClick={onClose} aria-label="Close definition">×</button>
        <header className="definition-sheet-header">
          <p className="eyebrow">dictionary</p>
          <h2 id="definition-sheet-title">{word}</h2>
          {entry?.shortDefinition && <p className="definition-sheet-summary">{entry.shortPartOfSpeech && <em>{partOfSpeechLabel(entry.shortPartOfSpeech)}</em>}{entry.shortDefinition}</p>}
        </header>

        {loading ? (
          <div className="definition-sheet-state" role="status" aria-live="polite"><Spinner size="sm" /><span>Looking up meanings…</span></div>
        ) : error ? (
          <div className="definition-sheet-state definition-sheet-state--error" role="alert" aria-live="assertive"><p>{error}</p><Button variant="secondary" size="sm" onClick={onClose}>Close</Button></div>
        ) : groups.length === 0 ? (
          <div className="definition-sheet-state" role="status"><p>No definition is available for this word in the current dictionary edition.</p><span className="muted">It remains a valid game word from the playable word list.</span></div>
        ) : (
          <div className="definition-groups">
            {groups.map((group) => <section key={group.partOfSpeech} className="definition-group"><h3>{partOfSpeechLabel(group.partOfSpeech)}</h3><ol>
              {group.senses.map((sense, index) => <li key={`${sense.definition}-${index}`} className={index === 0 && group === groups[0] ? 'definition-sense--primary' : ''}><p>{sense.definition}</p>{sense.examples.map((example) => <blockquote key={example}>{example}</blockquote>)}</li>)}
            </ol></section>)}
            {entry?.truncated && <p className="definition-sheet-limit-note">This unusually large entry was shortened for display.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
