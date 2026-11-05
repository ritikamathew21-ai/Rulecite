export type Fix = { start: number; end: number; quote: string; replacement: string };

// Works from the end of the text, so earlier offsets stay correct after each change.
// A fix is skipped if its quote no longer matches or it overlaps one already applied.
export function applyFixes(text: string, fixes: Fix[]) {
  let result = text;
  let applied = 0;
  let boundary = Infinity;

  for (const fix of [...fixes].sort((a, b) => b.start - a.start)) {
    if (fix.end > boundary || text.slice(fix.start, fix.end) !== fix.quote) continue;
    result = result.slice(0, fix.start) + fix.replacement + result.slice(fix.end);
    boundary = fix.start;
    applied++;
  }

  return { text: result, applied };
}
