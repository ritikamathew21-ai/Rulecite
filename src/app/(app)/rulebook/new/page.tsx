import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth/member";
import { createRule } from "@/lib/rules/actions";
import { RuleForm } from "../rule-form";

export const metadata: Metadata = { title: "Add rule" };

export default async function NewRulePage() {
  const member = await requireMember();
  if (member.role !== "admin") redirect("/rulebook");

  return (
    <>
      <h1 className="text-4xl font-bold tracking-tight">Add a rule</h1>
      <p className="mt-4 max-w-prose">New rules start as drafts. They are not used until you approve them.</p>
      <RuleForm action={createRule} cancelHref="/rulebook" submitLabel="Save draft" showCode />
    </>
  );
}
