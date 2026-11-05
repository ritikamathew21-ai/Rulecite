import { DISMISS_REASONS } from "@/lib/documents/labels";
import type { FindingRow } from "@/lib/documents/queries";
import { decideFinding } from "@/lib/documents/workflow-actions";
import { RULE_TYPE_LABELS, SEVERITY_LABELS } from "@/lib/rules/schema";
import { Field, fieldClass } from "../../form-field";

const STATE_LABELS = { open: "", accepted: "Accepted", edited: "Edited", dismissed: "Dismissed" };

const secondaryButton = "rounded border border-muted px-3 py-1.5 font-bold hover:border-ink";

function Hidden({ documentId, findingId, action }: { documentId: string; findingId: string; action: string }) {
  return (
    <>
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="findingId" value={findingId} />
      <input type="hidden" name="action" value={action} />
    </>
  );
}

export function FindingCard({
  finding,
  documentId,
  canDecide,
}: {
  finding: FindingRow;
  documentId: string;
  canDecide: boolean;
}) {
  const { citation, id, state } = finding;

  return (
    <li className="border-l-4 border-marker pl-4" aria-label={`Finding ${citation.code}`}>
      <p className="text-sm font-bold">
        {SEVERITY_LABELS[finding.severity]} severity, {RULE_TYPE_LABELS[finding.category]},{" "}
        {finding.origin === "rule" ? "rule-based" : "AI-assisted"}
        {state !== "open" && <span className="highlighted ml-2 px-1">{STATE_LABELS[state]}</span>}
      </p>
      {finding.quote && <p className="mt-1 font-bold">&ldquo;{finding.quote}&rdquo;</p>}
      <p className="mt-1">{finding.explanation}</p>
      <p className="mt-1">
        <span className="font-bold">Suggested fix: </span>
        {finding.suggestion}
      </p>
      {finding.resolution && (
        <p className="mt-1">
          <span className="font-bold">Your fix: </span>
          {finding.resolution}
        </p>
      )}
      <figure className="mt-2 text-sm">
        <figcaption className="font-bold text-pencil">
          {citation.code}: {citation.title} (version {citation.version})
        </figcaption>
        <blockquote className="mt-1">{citation.source_excerpt}</blockquote>
        <p className="text-muted">{citation.source_name}</p>
      </figure>

      {canDecide && (
        <div className="mt-3 flex flex-col items-start gap-2">
          <form action={decideFinding}>
            <Hidden documentId={documentId} findingId={id} action="accepted" />
            <button type="submit" className={secondaryButton}>
              {finding.replacement ? "Accept fix" : "Acknowledge"}
            </button>
          </form>
          {finding.quote && (
            <details className="w-full">
              <summary className="cursor-pointer font-bold">Edit fix</summary>
              <form action={decideFinding} className="mt-2 flex flex-col items-start gap-2">
                <Hidden documentId={documentId} findingId={id} action="edited" />
                <Field label="Replacement text">
                  <input
                    name="finalText"
                    required
                    maxLength={2000}
                    defaultValue={finding.resolution ?? finding.replacement ?? finding.quote}
                    className={fieldClass}
                  />
                </Field>
                <button type="submit" className={secondaryButton}>
                  Save fix
                </button>
              </form>
            </details>
          )}
          <details className="w-full">
            <summary className="cursor-pointer font-bold">Dismiss</summary>
            <form action={decideFinding} className="mt-2 flex flex-col items-start gap-2">
              <Hidden documentId={documentId} findingId={id} action="dismissed" />
              <Field label="Reason">
                <select name="reasonCode" required className={fieldClass}>
                  {Object.entries(DISMISS_REASONS).map(([value, reasonLabel]) => (
                    <option key={value} value={value}>
                      {reasonLabel}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Details" hint="Required if you choose Other.">
                <textarea name="reasonText" rows={2} maxLength={1000} className={fieldClass} />
              </Field>
              <button type="submit" className={secondaryButton}>
                Dismiss finding
              </button>
            </form>
          </details>
        </div>
      )}
    </li>
  );
}
