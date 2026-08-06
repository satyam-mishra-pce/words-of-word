export type GameMode = string;

export interface WordSubmissionEvaluation {
  isValid: boolean;
  normalizedWord: string;
  message: string;
}

export const POINTS_PER_WORD = 3;
export const DUPLICATE_WORD_PENALTY = -3;

export function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

export function isAlphabeticWord(word: string): boolean {
  return /^[a-z]+$/.test(word);
}

export function getLetterCounts(word: string): Map<string, number> {
  const counts = new Map<string, number>();

  for (const letter of word) {
    const current = counts.get(letter) ?? 0;
    counts.set(letter, current + 1);
  }

  return counts;
}

export function canMakeWord(candidate: string, sourceWord: string): boolean {
  const sourceCounts = getLetterCounts(sourceWord);
  const candidateCounts = getLetterCounts(candidate);

  for (const [letter, requiredCount] of candidateCounts.entries()) {
    const availableCount = sourceCounts.get(letter) ?? 0;
    if (availableCount < requiredCount) {
      return false;
    }
  }

  return true;
}

/**
 * Preprocessed dictionary data for repeated round starts. Counts live in one
 * contiguous typed array rather than allocating a Map for every word on every
 * round, which keeps the game loop responsive on small CPU allocations.
 */
export interface ValidWordIndex {
  words: readonly string[];
  wordLengths: Uint16Array;
  letterMasks: Uint32Array;
  letterCounts: Uint16Array;
}

const ALPHABET_SIZE = 26;
const A_CHAR_CODE = 'a'.charCodeAt(0);

function letterIndex(letter: string): number {
  return letter.charCodeAt(0) - A_CHAR_CODE;
}

function sourceLetterCounts(word: string): { counts: Uint16Array; mask: number } {
  const counts = new Uint16Array(ALPHABET_SIZE);
  let mask = 0;
  for (const letter of word) {
    const index = letterIndex(letter);
    counts[index] = (counts[index] ?? 0) + 1;
    mask |= 1 << index;
  }
  return { counts, mask };
}

/** Build once at server start and reuse for every round. */
export function createValidWordIndex(dictionary: readonly string[]): ValidWordIndex {
  const words: string[] = [];
  const lengths: number[] = [];
  const masks: number[] = [];
  const counts: number[] = [];

  for (const dictionaryWord of dictionary) {
    const normalizedWord = normalizeWord(dictionaryWord);
    if (!isAlphabeticWord(normalizedWord)) continue;

    const { counts: letterCounts, mask } = sourceLetterCounts(normalizedWord);
    words.push(normalizedWord);
    lengths.push(normalizedWord.length);
    masks.push(mask);
    for (let index = 0; index < ALPHABET_SIZE; index += 1) {
      counts.push(letterCounts[index] ?? 0);
    }
  }

  return {
    words,
    wordLengths: Uint16Array.from(lengths),
    letterMasks: Uint32Array.from(masks),
    letterCounts: Uint16Array.from(counts)
  };
}

/** Return all valid words without allocating per-dictionary-word Maps. */
export function createValidWordsFromIndex(sourceWord: string, dictionary: ValidWordIndex): Set<string> {
  const normalizedSource = normalizeWord(sourceWord);
  const validWords = new Set<string>();
  if (!isAlphabeticWord(normalizedSource)) return validWords;

  const source = sourceLetterCounts(normalizedSource);
  for (let wordIndex = 0; wordIndex < dictionary.words.length; wordIndex += 1) {
    if ((dictionary.wordLengths[wordIndex] ?? 0) > normalizedSource.length) continue;
    if (((dictionary.letterMasks[wordIndex] ?? 0) & ~source.mask) !== 0) continue;

    const offset = wordIndex * ALPHABET_SIZE;
    let possible = true;
    for (let letter = 0; letter < ALPHABET_SIZE; letter += 1) {
      if ((dictionary.letterCounts[offset + letter] ?? 0) > (source.counts[letter] ?? 0)) {
        possible = false;
        break;
      }
    }
    if (possible) validWords.add(dictionary.words[wordIndex] as string);
  }

  return validWords;
}

/**
 * Compatibility path for callers that have not preprocessed their dictionary.
 * Servers that start many rounds should use createValidWordIndex once and then
 * createValidWordsFromIndex for each round.
 */
export function createValidWords(sourceWord: string, dictionary: readonly string[]): Set<string> {
  const normalizedSource = normalizeWord(sourceWord);
  const validWords = new Set<string>();

  for (const dictionaryWord of dictionary) {
    const normalizedDictionaryWord = normalizeWord(dictionaryWord);
    if (isAlphabeticWord(normalizedDictionaryWord) && canMakeWord(normalizedDictionaryWord, normalizedSource)) {
      validWords.add(normalizedDictionaryWord);
    }
  }

  return validWords;
}

export function chooseSourceWord(dictionary: readonly string[], minimumLength: number): string | undefined {
  const candidates = dictionary.filter((word) => {
    const normalized = normalizeWord(word);
    return normalized.length >= minimumLength && isAlphabeticWord(normalized);
  });

  const randomIndex = Math.floor(Math.random() * candidates.length);
  return candidates[randomIndex];
}

export function evaluateSubmission(
  word: string,
  validWords: ReadonlySet<string>,
  alreadyAcceptedWords: ReadonlySet<string>
): WordSubmissionEvaluation {
  const normalizedWord = normalizeWord(word);

  if (!normalizedWord) {
    return {
      isValid: false,
      normalizedWord,
      message: 'Enter a word first.'
    };
  }

  if (!isAlphabeticWord(normalizedWord)) {
    return {
      isValid: false,
      normalizedWord,
      message: 'Words can only contain letters.'
    };
  }

  if (alreadyAcceptedWords.has(normalizedWord)) {
    return {
      isValid: false,
      normalizedWord,
      message: 'You have already found this word.'
    };
  }

  if (!validWords.has(normalizedWord)) {
    return {
      isValid: false,
      normalizedWord,
      message: 'That word cannot be made from the current letters.'
    };
  }

  return {
    isValid: true,
    normalizedWord,
    message: 'Word accepted!'
  };
}

export function scoreWord(word: string, gameMode: GameMode = 'classic'): number {
  if (gameMode === 'arcade' || gameMode === 'precision') {
    return POINTS_PER_WORD + normalizeWord(word).length;
  }

  return POINTS_PER_WORD;
}
