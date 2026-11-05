"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/member";
import { factCodeSchema, parseFact } from "@/lib/facts/schema";
import { createClient } from "@/lib/supabase/server";

export type FactFormValues = Record<string, string>;
export type FactFormState = { error: string } | undefined;

const SAVE_FAILED = "The fact could not be saved. Try again.";

const formValues = (formData: FormData) => Object.fromEntries(formData.entries()) as FactFormValues;

export async function createFact(_state: FactFormState, formData: FormData): Promise<FactFormState> {
  const member = await requireAdmin("/ledger");
  const values = formValues(formData);

  const code = factCodeSchema.safeParse(values.code);
  if (!code.success) return { error: code.error.issues[0].message };
  const fact = parseFact(values);
  if ("error" in fact) return { error: fact.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("facts")
    .insert({ ...fact.data, code: code.data, org_id: member.organization.id })
    .select("id")
    .single();
  if (error?.code === "23505") return { error: `The fact ID ${code.data} is already used.` };
  if (error) return { error: SAVE_FAILED };

  redirect(`/ledger/${data.id}`);
}

// Matching on version means a change only applies to the version the Admin was looking at.
export async function updateFact(
  id: string,
  version: number,
  _state: FactFormState,
  formData: FormData,
): Promise<FactFormState> {
  await requireAdmin("/ledger");

  const fact = parseFact(formValues(formData));
  if ("error" in fact) return { error: fact.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("facts")
    .update(fact.data)
    .eq("id", id)
    .eq("version", version)
    .select("id")
    .maybeSingle();
  if (error) return { error: SAVE_FAILED };
  if (!data) return { error: "This fact changed after you opened it. Reload the page and make your edit again." };

  revalidatePath(`/ledger/${id}`);
  redirect(`/ledger/${id}`);
}

const statusChange = z.object({
  id: z.uuid(),
  status: z.enum(["draft", "approved", "retired"]),
  expectedStatus: z.enum(["draft", "approved", "retired"]),
  version: z.coerce.number().int().positive(),
});

export async function setFactStatus(formData: FormData) {
  await requireAdmin("/ledger");
  const { id, status, expectedStatus, version } = statusChange.parse(Object.fromEntries(formData.entries()));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("facts")
    .update({ status })
    .eq("id", id)
    .eq("version", version)
    .eq("status", expectedStatus)
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Could not change the fact status");

  revalidatePath(`/ledger/${id}`);
  redirect(data ? `/ledger/${id}` : `/ledger/${id}?changed=1`);
}
