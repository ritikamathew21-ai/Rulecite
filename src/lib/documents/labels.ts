export const DOCUMENT_STATUS_LABELS = {
  draft: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
} as const;

export type DocumentStatus = keyof typeof DOCUMENT_STATUS_LABELS;

export const titleFromFileName = (name: string) =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .slice(0, 200);

// Fictional copy with planted problems, so a first check shows code and AI findings.
export const SAMPLE_DOCUMENT = {
  title: "Vornelle launch email (sample)",
  text: "Introducing the Vornelle e-wallet, with the lowest fees in India. New users get 2% back on their first ten payments. Transfers to a bank account cost ₹2 each. It is risk-free, and we guarantee you will save money every month. Earn reward points each time you pay. Our support team is here from 9am to 9pm IST every day.",
};

export const DISMISS_REASONS = {
  false_positive: "This is not actually a problem",
  rule_unclear: "The rule is unclear",
  intentional_exception: "This is an intentional exception",
  other: "Other",
} as const;
