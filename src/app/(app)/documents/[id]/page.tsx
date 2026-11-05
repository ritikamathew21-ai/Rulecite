import type { Metadata } from "next";
import Link from "next/link";
import { requireMember } from "@/lib/auth/member";
import { rerunCheck } from "@/lib/documents/actions";
import { DOCUMENT_STATUS_LABELS } from "@/lib/documents/labels";
import { getDocumentOr404, type FindingRow } from "@/lib/documents/queries";
import {
  addComment,
  applyAcceptedFixes,
  reviewDocument,
  submitForReview,
} from "@/lib/documents/workflow-actions";
import { Field, fieldClass } from "../../form-field";
import { FindingCard } from "./finding-card";

export const metadata: Metadata = { title: "Document" };

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

const PROBLEMS: Record<string, string> = {
  "open-high": "Decide every high severity finding before submitting.",
  "not-checked": "Run a check on this version before submitting.",
  stale: "This document changed, so nothing was applied. Review it, then try again.",
  "no-fixes": "There are no fixes to apply. Accept a fix or save your own first.",
  reason: "Choose a reason, and add details if you choose Other.",
  "edit-text": "Enter the replacement text.",
  comment: "Add a comment explaining what needs to change.",
  "empty-comment": "Enter a comment.",
  failed: "That did not work, and nothing was changed. Try again.",
};

const AI_SKIPPED_REASONS: Record<string, string> = {
  ai_not_run: "AI checks were not available.",
  ai_not_confirmed: "This content was not marked as fictional or synthetic, so it was not sent to AI.",
  ai_not_configured: "AI checks are not set up.",
  ai_no_rules: "There are no approved tone, messaging or claim rules to check against.",
  daily_limit: "Your organisation has reached its daily limit for AI checks. Try again tomorrow.",
  quota_exhausted: "The AI service's free quota has run out. Try again later.",
  rate_limited: "The AI service is receiving too many requests. Try again shortly.",
  provider_unavailable: "The AI service is busy or unavailable. Try again shortly.",
  timeout: "The AI service took too long to respond. Try again shortly.",
  provider_auth: "The AI service rejected this app's access.",
  provider_request: "The AI service could not process this request.",
  provider_blocked: "The AI service declined to review this content.",
  invalid_output: "The AI service returned an unusable answer, so it was ignored.",
};

const formatTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

const primaryButton = "rounded bg-pencil px-4 py-2 font-bold text-white hover:bg-ink";
const secondaryButton = "rounded border border-muted px-4 py-2 font-bold hover:border-ink";

function DraftText({ text, findings }: { text: string; findings: FindingRow[] }) {
  const marks = findings
    .filter((finding) => finding.start_offset !== null)
    .sort((a, b) => a.start_offset! - b.start_offset!);

  const parts: React.ReactNode[] = [];
  let position = 0;
  for (const { id, start_offset, end_offset } of marks) {
    if (start_offset! < position) continue;
    parts.push(text.slice(position, start_offset!));
    parts.push(
      <mark key={id} className="highlighted">
        {text.slice(start_offset!, end_offset!)}
      </mark>,
    );
    position = end_offset!;
  }
  parts.push(text.slice(position));

  return <p className="max-w-prose whitespace-pre-wrap rounded border border-line bg-white p-4">{parts}</p>;
}

function DocumentAction({
  action,
  documentId,
  number,
  label,
  primary = false,
}: {
  action: (formData: FormData) => Promise<void>;
  documentId: string;
  number: number;
  label: string;
  primary?: boolean;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="number" value={number} />
      <button type="submit" className={primary ? primaryButton : secondaryButton}>
        {label}
      </button>
    </form>
  );
}

export default async function DocumentPage({ params, searchParams }: PageProps<"/documents/[id]">) {
  const member = await requireMember();
  const { id } = await params;
  const { check, error, version: versionParam } = await searchParams;
  const requested = typeof versionParam === "string" ? Number(versionParam) : undefined;
  const { document, versions, version, isLatest, run, findings, comments } = await getDocumentOr404(id, requested);

  const isAuthor = document.created_by === member.userId;
  const open = document.status === "draft" || document.status === "changes_requested";
  const canDecide = isAuthor && isLatest && open && run !== null;
  const canEdit = isAuthor && isLatest && document.status !== "in_review";
  const canReview = !isAuthor && member.role !== "creator" && document.status === "in_review" && isLatest;
  const hasFixes = findings.some(({ state, quote, replacement }) => quote && (state === "edited" || (state === "accepted" && replacement)));
  const hasDecisions = findings.some(({ state }) => state !== "open");
  const approvedVersion = versions.find(({ id: versionId }) => versionId === document.approved_version_id);

  const ordered = [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const problem = typeof error === "string" ? PROBLEMS[error] : undefined;

  return (
    <>
      <Link href="/documents" className="text-pencil underline">
        Back to documents
      </Link>
      <h1 className="mt-4 text-4xl font-bold tracking-tight">{document.title}</h1>
      <p className="mt-2">
        <span className="font-bold">{DOCUMENT_STATUS_LABELS[document.status]}</span>, showing version {version.number}
        {!isLatest && " (an older version)"}
      </p>
      {approvedVersion && document.approved_at && (
        <p className="highlighted mt-3 inline-block px-1.5">
          Version {approvedVersion.number} approved {formatTime.format(new Date(document.approved_at))}.
        </p>
      )}

      {problem && (
        <p role="alert" className="highlighted mt-4 block w-fit px-1.5">
          {problem}
        </p>
      )}
      {check === "failed" && (
        <p role="alert" className="highlighted mt-4 block w-fit px-1.5">
          The check could not be completed, so no result was saved. Your document is safe. Try again.
        </p>
      )}

      {!run && <p className="mt-4 max-w-prose font-bold">This version has not been checked.</p>}
      {run?.status === "partial" && (
        <p className="mt-4 max-w-prose">
          <span className="font-bold">AI checks skipped.</span>{" "}
          {AI_SKIPPED_REASONS[run.failure_reason ?? ""] ?? "AI checks did not complete."} Tone, messaging and claims were
          not reviewed, so this is not a full review.
        </p>
      )}
      {run?.status === "complete" && (
        <p className="mt-4 max-w-prose">
          Code and AI checks both ran. AI findings are suggestions and can be wrong, so people make the final decision.
          {run.dropped_count > 0 &&
            ` ${run.dropped_count} AI ${run.dropped_count === 1 ? "suggestion was" : "suggestions were"} removed because the citation could not be verified.`}
        </p>
      )}

      {version.source_type === "pdf" && (
        <p className="mt-4 max-w-prose">
          This came from a PDF, so only its text was checked. Images, alt text and colours were not reviewed.
        </p>
      )}

      <h2 className="mt-8 text-xl font-bold">Your draft</h2>
      <div className="mt-2">
        <DraftText text={version.plain_text} findings={findings} />
      </div>

      {(canEdit || (isAuthor && isLatest && open)) && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {canDecide && (
            <DocumentAction
              action={submitForReview}
              documentId={document.id}
              number={version.number}
              label="Submit for review"
              primary
            />
          )}
          {canDecide && hasFixes && (
            <DocumentAction
              action={applyAcceptedFixes}
              documentId={document.id}
              number={version.number}
              label="Apply fixes as a new version"
            />
          )}
          {canEdit && (
            <Link href={`/documents/${document.id}/edit`} className="text-pencil underline">
              Edit draft
            </Link>
          )}
        </div>
      )}

      {canReview && (
        <section className="mt-8 max-w-prose rounded border border-line bg-white p-4">
          <h2 className="text-xl font-bold">Your review of version {version.number}</h2>
          <form action={reviewDocument} className="mt-3 flex flex-col gap-3">
            <input type="hidden" name="documentId" value={document.id} />
            <input type="hidden" name="number" value={version.number} />
            <Field label="Review comment" hint="Required if you request changes.">
              <textarea name="comment" rows={3} maxLength={2000} className={fieldClass} />
            </Field>
            <div className="flex flex-wrap gap-3">
              <button type="submit" name="decision" value="approved" className={primaryButton}>
                Approve version {version.number}
              </button>
              <button type="submit" name="decision" value="changes_requested" className={secondaryButton}>
                Request changes
              </button>
            </div>
          </form>
        </section>
      )}
      {isAuthor && member.role !== "creator" && document.status === "in_review" && (
        <p className="mt-4 max-w-prose">Someone else must review this document, because you wrote it.</p>
      )}

      {run && (
        <>
          <h2 className="mt-8 text-xl font-bold">Findings ({findings.length})</h2>
          {ordered.length === 0 ? (
            <p className="mt-2 max-w-prose">
              {run.status === "complete"
                ? "No problems were found against your approved rules and facts."
                : "Code checks found no problems with the approved rules they cover."}
            </p>
          ) : (
            <ul className="mt-3 max-w-prose space-y-6">
              {ordered.map((finding) => (
                <FindingCard key={finding.id} finding={finding} documentId={document.id} canDecide={canDecide} />
              ))}
            </ul>
          )}
        </>
      )}

      {isLatest && open && !hasDecisions && (
        <form action={rerunCheck} className="mt-4">
          <input type="hidden" name="documentId" value={document.id} />
          <button type="submit" className={secondaryButton}>
            {run ? "Run check again" : "Run check"}
          </button>
        </form>
      )}

      <h2 className="mt-8 text-xl font-bold">Comments</h2>
      {comments.length === 0 ? (
        <p className="mt-2">No comments yet.</p>
      ) : (
        <ul className="mt-2 max-w-prose space-y-3">
          {comments.map((comment) => (
            <li key={comment.id}>
              <p className="text-sm font-bold">
                {comment.author_name}, {formatTime.format(new Date(comment.created_at))}
              </p>
              <p className="whitespace-pre-wrap">{comment.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form action={addComment} className="mt-3 flex max-w-prose flex-col items-start gap-2">
        <input type="hidden" name="documentId" value={document.id} />
        <Field label="Add a comment">
          <textarea name="body" required rows={2} maxLength={2000} className={fieldClass} />
        </Field>
        <button type="submit" className={secondaryButton}>
          Post comment
        </button>
      </form>

      <h2 className="mt-8 text-xl font-bold">Versions</h2>
      <ul className="mt-2 space-y-1">
        {versions.map(({ id: versionId, number, created_at }) => (
          <li key={versionId}>
            <Link href={`/documents/${document.id}?version=${number}`} className="text-pencil underline">
              Version {number}
            </Link>
            , saved {formatTime.format(new Date(created_at))}
            {versionId === document.approved_version_id && " (approved)"}
          </li>
        ))}
      </ul>
    </>
  );
}
