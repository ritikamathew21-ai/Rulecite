"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { parseAsset } from "@/lib/assets/schema";
import { requireAdmin } from "@/lib/auth/member";
import { createClient } from "@/lib/supabase/server";

export type AssetFormState = { error: string } | undefined;

export async function createAsset(_state: AssetFormState, formData: FormData): Promise<AssetFormState> {
  const member = await requireAdmin("/assets");

  const asset = parseAsset(Object.fromEntries(formData.entries()));
  if ("error" in asset) return { error: asset.error };

  const supabase = await createClient();
  const { error } = await supabase.from("assets").insert({ ...asset.data, org_id: member.organization.id });
  if (error?.code === "23505") return { error: `The colour ID ${asset.data.code} is already used.` };
  if (error) return { error: "The colour could not be saved. Try again." };

  revalidatePath("/assets");
  redirect("/assets");
}

const statusChange = z.object({
  id: z.uuid(),
  status: z.enum(["draft", "approved", "retired"]),
  expectedStatus: z.enum(["draft", "approved", "retired"]),
});

export async function setAssetStatus(formData: FormData) {
  await requireAdmin("/assets");
  const { id, status, expectedStatus } = statusChange.parse(Object.fromEntries(formData.entries()));

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assets")
    .update({ status })
    .eq("id", id)
    .eq("status", expectedStatus)
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Could not change the colour status");

  revalidatePath("/assets");
  redirect(data ? "/assets" : "/assets?changed=1");
}
