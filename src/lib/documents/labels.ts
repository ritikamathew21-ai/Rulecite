export const DOCUMENT_STATUS_LABELS = {
  draft: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
} as const;

export type DocumentStatus = keyof typeof DOCUMENT_STATUS_LABELS;

export const DISMISS_REASONS = {
  false_positive: "This is not actually a problem",
  rule_unclear: "The rule is unclear",
  intentional_exception: "This is an intentional exception",
  other: "Other",
} as const;
