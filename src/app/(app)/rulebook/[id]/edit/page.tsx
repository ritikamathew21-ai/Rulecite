import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth/member";
import { updateRule } from "@/lib/rules/actions";
import { getRuleOr404 } from "@/lib/rules/queries";
import { RuleForm } from "../../rule-form";

export const metadata: Metadata = { title: "Edit rule" };

export default async function EditRulePage({ params }: PageProps<"/rulebook/[id]/edit">) {
  const member = await requireMember();
  if (member.role !== "admin") redirect("/rulebook");

  const { id } = await params;
  const rule = await getRuleOr404(id);
  if (rule.status === "retired") redirect(`/rulebook/${rule.id}`);

  return (
    <>
      <h1 className="text-4xl font-bold tracking-tight">Edit {rule.code}</h1>
      <RuleForm
        action={updateRule.bind(null, rule.id, rule.version)}
        cancelHref={`/rulebook/${rule.id}`}
        submitLabel="Save changes"
        initial={{
          type: rule.type,
          severity: rule.severity,
          title: rule.title,
          instruction: rule.instruction,
          sourceExcerpt: rule.source_excerpt,
          sourceName: rule.source_name,
          preferred: rule.config.preferred ?? "",
          terms: (rule.config.variants ?? rule.config.phrases ?? []).join(", "),
        }}
      />
    </>
  );
}
