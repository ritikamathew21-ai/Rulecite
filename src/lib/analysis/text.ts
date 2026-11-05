export const MAX_TEXT_LENGTH = 50_000;

export const normaliseText = (text: string) =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type Match = { quote: string; start: number; end: number };

// Whole words only, so "wallet" never matches inside "wallets" or "ewallet".
export function findTerm(text: string, term: string): Match[] {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, "giu");
  return [...text.matchAll(pattern)].map((match) => ({
    quote: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

export type Sentence = Match & { words: number };

export function splitSentences(text: string): Sentence[] {
  return [...text.matchAll(/[^.!?\n]+[.!?]*/g)]
    .map((match) => {
      const quote = match[0].trim();
      const start = match.index + match[0].indexOf(quote);
      return { quote, start, end: start + quote.length, words: countWords(quote) };
    })
    .filter(({ words }) => words > 0);
}

const words = (text: string) => text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];

export const countWords = (text: string) => words(text).length;

// An approximation: English spelling has no exact syllable rule.
export function countSyllables(word: string) {
  const letters = word.toLowerCase().replace(/[^a-z]/g, "");
  if (letters.length <= 3) return 1;
  const trimmed = letters.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  return Math.max(1, trimmed.match(/[aeiouy]{1,2}/g)?.length ?? 1);
}

// Flesch-Kincaid grade level.
export function readingGrade(text: string) {
  const allWords = words(text);
  const sentences = splitSentences(text).length;
  if (allWords.length === 0 || sentences === 0) return 0;
  const syllables = allWords.reduce((total, word) => total + countSyllables(word), 0);
  return 0.39 * (allWords.length / sentences) + 11.8 * (syllables / allWords.length) - 15.59;
}
