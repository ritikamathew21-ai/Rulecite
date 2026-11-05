"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/member";
import { parseRule, ruleCodeSchema } from "@/lib/rules/schema";
import { createClient } from "@/lib/supabase/server";

export type RuleFormValues = Record<string, string>;
export type RuleFormState = { error: string } | undefined;

const SAVE_FAILED = "The rule could not be saved. Try again.";

const formValues = (formData: FormData) => Object.fromEntries(formData.entries()) as RuleFormValues;

export async function createRule(_state: RuleFormState, formData: FormData): Promise<RuleFormState> {
  const member = await requireAdmin("/rulebook");
  const values = formValues(formData);

  const code = ruleCodeSchema.safeParse(values.code);
  if (!code.success) return { error: code.error.issues[0].message };
  const rule = parseRule(values);
  if ("error" in rule) return { error: rule.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rules")
    .insert({ ...rule.data, code: code.data, org_id: member.organization.id })
    .select("id")
    .single();
  if (error?.code === "23505") return { error: `The rule ID ${code.data} is already used.` };
  if (error) return { error: SAVE_FAILED };

  redirect(`/rulebook/${data.id}`);
}

// Matching on version means a change only applies to the version the Admin was looking at.
export async function updateRule(
  id: string,
  version: number,
  _state: RuleFormState,
  formData: FormData,
): Promise<RuleFormState> {
  await requireAdmin("/rulebook");
  const values = formValues(formData);

  const rule = parseRule(values);
  if ("error" in rule) return { error: rule.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rules")
    .update(rule.data)
    .eq("id", id)
    .eq("version", version)
    .select("id")
    .maybeSingle();
  if (error) return { error: SAVE_FAILED };
  if (!data) return { error: "This rule changed after you opened it. Reload the page and make your edit again." };

  revalidatePath(`/rulebook/${id}`);
  redirect(`/rulebook/${id}`);
}

const statusChange = z.object({
  id: z.uuid(),
  status: z.enum(["draft", "approved", "retired"]),
  expectedStatus: z.enum(["draft", "approved", "retired"]),
  version: z.coerce.number().int().positive(),
});

export async function setRuleStatus(formData: FormData) {
  await requireAdmin("/rulebook");
  const { id, status, expectedStatus, version } = statusChange.parse(Object.fromEntries(formData.entries()));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rules")
    .update({ status })
    .eq("id", id)
    .eq("version", version)
    .eq("status", expectedStatus)
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Could not change the rule status");

  revalidatePath(`/rulebook/${id}`);
  redirect(data ? `/rulebook/${id}` : `/rulebook/${id}?changed=1`);
}
