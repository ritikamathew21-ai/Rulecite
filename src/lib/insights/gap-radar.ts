export const MIN_DECISIONS = 3;
const UNCLEAR_DISMISSAL_RATE = 0.5;
const UNCLEAR_REASON_COUNT = 2;

export type InsightFinding = {
  id: string;
  document_id: string;
  quote: string | null;
  state: "open" | "accepted" | "edited" | "dismissed";
  created_at: string;
  citation: { id: string; code: string; title: string };
};

export type InsightDecision = {
  finding_id: string;
  action: string;
  reason_code: string | null;
  created_at: string;
};

export type RuleInsight = {
  ruleId: string;
  code: string;
  title: string;
  documents: number;
  flagged: number;
  resolved: number;
  dismissed: number;
  open: number;
  decided: number;
  reasons: Record<string, number>;
  dismissalRate: number;
  likelyUnclear: boolean;
};

// A check repeats a problem on every rerun and version, so each one counts once, with its latest outcome.
const latestPerProblem = (findings: InsightFinding[]) => {
  const problems = new Map<string, InsightFinding>();
  for (const finding of findings) {
    const key = `${finding.document_id}|${finding.citation.code}|${finding.quote ?? ""}`;
    const current = problems.get(key);
    if (!current || finding.created_at > current.created_at) problems.set(key, finding);
  }
  return [...problems.values()];
};

export function buildGapRadar(findings: InsightFinding[], decisions: InsightDecision[]): RuleInsight[] {
  const reasonFor = new Map<string, string>();
  const ordered = [...decisions].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const { finding_id, action, reason_code } of ordered) {
    if (action === "dismissed" && reason_code) reasonFor.set(finding_id, reason_code);
    else reasonFor.delete(finding_id);
  }

  const insights = new Map<string, RuleInsight & { documentIds: Set<string> }>();
  for (const finding of latestPerProblem(findings)) {
    const { id: ruleId, code, title } = finding.citation;
    const insight =
      insights.get(code) ??
      {
        ruleId,
        code,
        title,
        documents: 0,
        flagged: 0,
        resolved: 0,
        dismissed: 0,
        open: 0,
        decided: 0,
        reasons: {},
        dismissalRate: 0,
        likelyUnclear: false,
        documentIds: new Set<string>(),
      };
    insights.set(code, insight);

    insight.flagged++;
    insight.documentIds.add(finding.document_id);
    if (finding.state === "open") insight.open++;
    else if (finding.state === "dismissed") {
      insight.dismissed++;
      const reason = reasonFor.get(finding.id);
      if (reason) insight.reasons[reason] = (insight.reasons[reason] ?? 0) + 1;
    } else insight.resolved++;
  }

  return [...insights.values()]
    .map(({ documentIds, ...insight }) => {
      const decided = insight.resolved + insight.dismissed;
      const dismissalRate = decided === 0 ? 0 : insight.dismissed / decided;
      const likelyUnclear =
        decided >= MIN_DECISIONS &&
        (dismissalRate >= UNCLEAR_DISMISSAL_RATE || (insight.reasons.rule_unclear ?? 0) >= UNCLEAR_REASON_COUNT);
      return { ...insight, documents: documentIds.size, decided, dismissalRate, likelyUnclear };
    })
    .sort((a, b) => Number(b.likelyUnclear) - Number(a.likelyUnclear) || b.flagged - a.flagged || a.code.localeCompare(b.code));
}
