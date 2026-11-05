import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import type { RuleStatus } from "@/lib/rules/schema";
import { createClient } from "@/lib/supabase/server";

export type Fact = {
  id: string;
  code: string;
  statement: string;
  source_name: string;
  source_url: string | null;
  valid_from: string;
  expires_on: string | null;
  status: RuleStatus;
  version: number;
  approved_at: string | null;
};

// Row-level security decides visibility, so a hidden fact looks the same as a missing one.
export async function getFactOr404(id: string) {
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.from("facts").select("*").eq("id", id).maybeSingle<Fact>();
  if (error) throw new Error("Could not load the fact");
  if (!data) notFound();
  return data;
}
