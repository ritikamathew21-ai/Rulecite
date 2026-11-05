import "server-only";
import { runChecks } from "@/lib/analysis/run";
import type { VersionRow } from "@/lib/documents/queries";
import type { createClient } from "@/lib/supabase/server";

// Returns false rather than throwing, because the document stays saved if a check fails.
export async function checkLatestVersion(supabase: Awaited<ReturnType<typeof createClient>>, documentId: string) {
  try {
    const { data: version, error } = await supabase
      .from("document_versions")
      .select("*")
      .eq("document_id", documentId)
      .order("number", { ascending: false })
      .limit(1)
      .single<VersionRow>();
    if (error) return false;
    await runChecks(supabase, version);
    return true;
  } catch {
    return false;
  }
}
