import type { Metadata } from "next";
import Link from "next/link";
import { requireMember } from "@/lib/auth/member";
import { rerunCheck } from "@/lib/documents/actions";
import { getDocumentOr404, type FindingRow } from "@/lib/documents/queries";
import { RULE_TYPE_LABELS, SEVERITY_LABELS } from "@/lib/rules/schema";

export const metadata: Metadata = { title: "Document" };

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

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

function FindingCard({ finding }: { finding: FindingRow }) {
  const { citation } = finding;
  return (
    <li className="border-l-4 border-marker pl-4">
      <p className="text-sm font-bold">
        {SEVERITY_LABELS[finding.severity]} severity, {RULE_TYPE_LABELS[finding.category]},{" "}
        {finding.origin === "rule" ? "rule-based" : "AI-assisted"}
      </p>
      {finding.quote && <p className="mt-1 font-bold">&ldquo;{finding.quote}&rdquo;</p>}
      <p className="mt-1">{finding.explanation}</p>
      <p className="mt-1">
        <span className="font-bold">Suggested fix: </span>
        {finding.suggestion}
      </p>
      <figure className="mt-2 text-sm">
        <figcaption className="font-bold text-pencil">
          {citation.code}: {citation.title} (version {citation.version})
        </figcaption>
        <blockquote className="mt-1">{citation.source_excerpt}</blockquote>
        <p className="text-muted">{citation.source_name}</p>
      </figure>
    </li>
  );
}

function RunAgain({ documentId, label }: { documentId: string; label: string }) {
  return (
    <form action={rerunCheck} className="mt-4">
      <input type="hidden" name="documentId" value={documentId} />
      <button type="submit" className="rounded border border-muted px-4 py-2 font-bold hover:border-ink">
        {label}
      </button>
    </form>
  );
}

export default async function DocumentPage({ params, searchParams }: PageProps<"/documents/[id]">) {
  await requireMember();
  const { id } = await params;
  const { check } = await searchParams;
  const { document, version, run, findings } = await getDocumentOr404(id);

  const ordered = [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return (
    <>
      <Link href="/documents" className="text-pencil underline">
        Back to documents
      </Link>
      <h1 className="mt-4 text-4xl font-bold tracking-tight">{document.title}</h1>

      {check === "failed" && (
        <p role="alert" className="highlighted mt-4 inline-block px-1.5">
          The check could not be completed, so no result was saved. Your document is safe. Try again.
        </p>
      )}

      {!run ? (
        <>
          <p className="mt-4 max-w-prose font-bold">This document has not been checked.</p>
          <RunAgain documentId={document.id} label="Run check" />
        </>
      ) : (
        <>
          {run.failure_reason === "ai_not_run" && (
            <p className="mt-4 max-w-prose">
              <span className="font-bold">AI checks skipped.</span> Tone, messaging and claims were not reviewed, so this
              is not a full review.
            </p>
          )}

          <h2 className="mt-8 text-xl font-bold">Your draft</h2>
          <div className="mt-2">
            <DraftText text={version.plain_text} findings={findings} />
          </div>

          <h2 className="mt-8 text-xl font-bold">Findings ({findings.length})</h2>
          {ordered.length === 0 ? (
            <p className="mt-2 max-w-prose">Code checks found no problems with the approved rules they cover.</p>
          ) : (
            <ul className="mt-3 max-w-prose space-y-6">
              {ordered.map((finding) => (
                <FindingCard key={finding.id} finding={finding} />
              ))}
            </ul>
          )}
          <RunAgain documentId={document.id} label="Run check again" />
        </>
      )}
    </>
  );
}
