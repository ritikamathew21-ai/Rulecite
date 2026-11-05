export const fieldClass = "rounded border border-muted bg-white px-3 py-2";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-bold">{label}</span>
      {hint && <span className="text-sm text-muted">{hint}</span>}
      {children}
    </label>
  );
}
