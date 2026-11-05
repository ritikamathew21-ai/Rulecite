import type { RuleStatus } from "@/lib/rules/schema";

const NEXT_STATUSES: Record<RuleStatus, RuleStatus[]> = {
  draft: ["approved", "retired"],
  approved: ["retired"],
  retired: ["draft"],
};

const label = (status: RuleStatus, noun: string) =>
  status === "approved" ? `Approve ${noun}` : status === "retired" ? `Retire ${noun}` : "Restore as draft";

type StatusActionsProps = {
  action: (formData: FormData) => Promise<void>;
  id: string;
  status: RuleStatus;
  noun: string;
  version?: number;
};

export function StatusActions({ action, id, status, noun, version }: StatusActionsProps) {
  return NEXT_STATUSES[status].map((next) => (
    <form key={next} action={action}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={next} />
      <input type="hidden" name="expectedStatus" value={status} />
      {version !== undefined && <input type="hidden" name="version" value={version} />}
      <button
        type="submit"
        className={
          next === "approved"
            ? "rounded bg-pencil px-4 py-2 font-bold text-white hover:bg-ink"
            : "rounded border border-muted px-4 py-2 font-bold hover:border-ink"
        }
      >
        {label(next, noun)}
      </button>
    </form>
  ));
}
