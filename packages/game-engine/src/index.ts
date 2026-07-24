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
