import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { getPublicEnv } from "@/lib/env";

const HEALTH_TIMEOUT_MS = 5_000;

const respond = (healthy: boolean) =>
  NextResponse.json(
    healthy ? { status: "ok", database: "ok" } : { status: "degraded", database: "unavailable" },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );

export async function GET() {
  try {
    const { url, publishableKey } = getPublicEnv();
    const client = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.rpc("health_check").abortSignal(AbortSignal.timeout(HEALTH_TIMEOUT_MS));
    return respond(!error && data === true);
  } catch {
    return respond(false);
  }
}
