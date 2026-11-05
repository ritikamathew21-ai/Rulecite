import { contrastRatio } from "@/lib/analysis/contrast";
import { findTerm, readingGrade, splitSentences, countWords, type Match } from "@/lib/analysis/text";
import type { ApprovedRule, Citation, FindingDraft, ParsedDocument } from "@/lib/analysis/types";

export const DEFAULT_MAX_GRADE = 9;
const MIN_WORDS_FOR_GRADE = 30;
const LONG_SENTENCE_WORDS = 30;
const MIN_CONTRAST = 4.5;
const WHITE = "#FFFFFF";

const citation = ({ id, code, version, title, instruction, source_excerpt, source_name }: ApprovedRule): Citation => ({
  id,
  code,
  version,
  title,
  instruction,
  source_excerpt,
  source_name,
});

const finding = (
  rule: ApprovedRule,
  match: Match | null,
  explanation: string,
  suggestion: string,
  replacement: string | null = null,
): FindingDraft => ({
  origin: "rule",
  category: rule.type,
  severity: rule.severity,
  quote: match?.quote ?? null,
  start: match?.start ?? null,
  end: match?.end ?? null,
  explanation,
  suggestion,
  replacement,
  citation: citation(rule),
});

const overlaps = (first: Match, second: Match) => first.start < second.end && second.start < first.end;

function checkTerminology(rule: ApprovedRule, text: string) {
  const { preferred, variants = [] } = rule.config;
  if (!preferred) return [];
  // Longest terms first, so "e-wallet" is reported once rather than also as "wallet".
  const claimed = findTerm(text, preferred);
  const findings: FindingDraft[] = [];
  for (const variant of [...variants].sort((a, b) => b.length - a.length)) {
    for (const match of findTerm(text, variant)) {
      if (claimed.some((taken) => overlaps(match, taken))) continue;
      claimed.push(match);
      findings.push(
        finding(rule, match, `"${match.quote}" is not the approved term.`, `Replace it with "${preferred}".`, preferred),
      );
    }
  }
  return findings.sort((a, b) => a.start! - b.start!);
}

function checkBannedPhrases(rule: ApprovedRule, text: string) {
  return (rule.config.phrases ?? []).flatMap((phrase) =>
    findTerm(text, phrase).map((match) =>
      finding(rule, match, `"${match.quote}" is a banned phrase.`, "Reword this without the banned phrase."),
    ),
  );
}

function checkReadability(rule: ApprovedRule, text: string) {
  const maxGrade = rule.config.maxGrade ?? DEFAULT_MAX_GRADE;
  const longSentences = splitSentences(text)
    .filter(({ words }) => words > LONG_SENTENCE_WORDS)
    .map((sentence) =>
      finding(
        rule,
        sentence,
        `This sentence has ${sentence.words} words, which is hard to read.`,
        "Split it into shorter sentences.",
      ),
    );

  // The formula is unreliable on very short text.
  if (countWords(text) < MIN_WORDS_FOR_GRADE) return longSentences;
  const grade = readingGrade(text);
  if (grade <= maxGrade) return longSentences;
  return [
    finding(
      rule,
      null,
      `The estimated reading grade is ${grade.toFixed(1)}, above the target of ${maxGrade}. This is an approximate measure.`,
      "Use shorter sentences and simpler words.",
    ),
    ...longSentences,
  ];
}

function checkAltText(rule: ApprovedRule, { images }: ParsedDocument) {
  return images
    .filter(({ alt }) => !alt.trim())
    .map(({ name }) =>
      finding(rule, null, `The image "${name}" has no alt text.`, "Add a short description of what the image shows."),
    );
}

const locate = (text: string, quote: string): Match | null => {
  const start = text.indexOf(quote);
  return start === -1 ? null : { quote, start, end: start + quote.length };
};

function checkContrast(rule: ApprovedRule, { text, colours }: ParsedDocument) {
  return colours.flatMap(({ text: runText, colour, background }) => {
    const ratio = contrastRatio(colour, background ?? WHITE);
    if (ratio >= MIN_CONTRAST) return [];
    return [
      finding(
        rule,
        locate(text, runText),
        `${colour} on ${background ?? "white"} has a contrast ratio of ${ratio.toFixed(1)}:1, below the ${MIN_CONTRAST}:1 minimum.`,
        "Use a darker text colour or a lighter background.",
      ),
    ];
  });
}

function checkPalette(rule: ApprovedRule, { text, colours }: ParsedDocument, palette: string[]) {
  if (palette.length === 0) return [];
  return colours.flatMap(({ text: runText, colour }) =>
    palette.includes(colour)
      ? []
      : [
          finding(
            rule,
            locate(text, runText),
            `The text colour ${colour} is not in the approved palette.`,
            `Use an approved colour: ${palette.join(", ")}.`,
          ),
        ],
  );
}

export function runDeterministicChecks(document: ParsedDocument, rules: ApprovedRule[], palette: string[]) {
  return rules.flatMap((rule) => {
    switch (rule.type) {
      case "terminology":
        return checkTerminology(rule, document.text);
      case "banned_phrase":
        return checkBannedPhrases(rule, document.text);
      case "readability":
        return checkReadability(rule, document.text);
      case "accessibility":
        return checkAltText(rule, document);
      case "contrast":
        return checkContrast(rule, document);
      case "visual":
        return checkPalette(rule, document, palette);
      default:
        return [];
    }
  });
}
