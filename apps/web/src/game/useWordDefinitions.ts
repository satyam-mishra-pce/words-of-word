import { useEffect, useRef, useState } from 'react';
import type { DictionaryEntry } from '@wow/shared';
import { lookupDictionaryWords } from '../services/dictionary';

export interface WordDefinitionSheetProps {
  word: string | undefined;
  entry: DictionaryEntry | undefined;
  loading: boolean;
  error: string;
  onClose: () => void;
}

export interface WordDefinitionsApi {
  /** Open the definition sheet for a word, fetching (and caching) as needed. */
  openWordDefinition: (input: string) => Promise<void>;
  closeDefinitionSheet: () => void;
  /** Warm the cache so later opens are instant (e.g. after a round ends). */
  prefetchDefinitions: (words: readonly string[]) => Promise<void>;
  /** Read a cached entry without opening the sheet (e.g. for a source word gloss). */
  getCachedEntry: (word: string) => DictionaryEntry | undefined;
  /** Props to spread onto <WordDefinitionSheet />. */
  sheetProps: WordDefinitionSheetProps;
  /** True while a definition sheet is open (used to gate other overlays). */
  isOpen: boolean;
}

/**
 * Shared word-definition behaviour for every game surface: one cache, one request
 * race-guard, one open/close/prefetch contract. Both the multiplayer room and the
 * single-player daily run consume this, so definitions can never regress on one
 * surface while working on the other.
 */
export function useWordDefinitions(): WordDefinitionsApi {
  const [definitionWord, setDefinitionWord] = useState<string>();
  const [definitionEntry, setDefinitionEntry] = useState<DictionaryEntry>();
  const [definitionLoading, setDefinitionLoading] = useState(false);
  const [definitionError, setDefinitionError] = useState('');
  const cacheRef = useRef<Map<string, DictionaryEntry>>(new Map());
  const requestRef = useRef(0);

  function closeDefinitionSheet(): void {
    requestRef.current += 1;
    setDefinitionWord(undefined);
    setDefinitionEntry(undefined);
    setDefinitionLoading(false);
    setDefinitionError('');
  }

  async function openWordDefinition(input: string): Promise<void> {
    const word = input.trim().toLowerCase();
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setDefinitionWord(word);
    setDefinitionError('');
    const cached = cacheRef.current.get(word);
    if (cached) {
      setDefinitionEntry(cached);
      setDefinitionLoading(false);
      return;
    }

    setDefinitionEntry(undefined);
    setDefinitionLoading(true);
    try {
      const entries = await lookupDictionaryWords([word]);
      const entry = entries[word] ?? { word, senses: [] };
      cacheRef.current.set(word, entry);
      if (requestRef.current === requestId) setDefinitionEntry(entry);
    } catch {
      if (requestRef.current === requestId) {
        setDefinitionError('Could not load this definition. Check your connection and try again.');
      }
    } finally {
      if (requestRef.current === requestId) setDefinitionLoading(false);
    }
  }

  async function prefetchDefinitions(words: readonly string[]): Promise<void> {
    const missing = Array.from(new Set(words.map((word) => word.trim().toLowerCase())))
      .filter((word) => /^[a-z]+$/.test(word) && !cacheRef.current.has(word));
    for (let index = 0; index < missing.length; index += 100) {
      try {
        const entries = await lookupDictionaryWords(missing.slice(index, index + 100));
        for (const [word, entry] of Object.entries(entries)) cacheRef.current.set(word, entry);
      } catch {
        return;
      }
    }
  }

  function getCachedEntry(word: string): DictionaryEntry | undefined {
    return cacheRef.current.get(word.trim().toLowerCase());
  }

  // Invalidate any in-flight request when the surface unmounts.
  useEffect(() => () => { requestRef.current += 1; }, []);

  return {
    openWordDefinition,
    closeDefinitionSheet,
    prefetchDefinitions,
    getCachedEntry,
    sheetProps: {
      word: definitionWord,
      entry: definitionEntry,
      loading: definitionLoading,
      error: definitionError,
      onClose: closeDefinitionSheet
    },
    isOpen: definitionWord !== undefined
  };
}
