import "server-only";
import { createGeminiProvider } from "@/lib/ai/gemini";
import type { AnalysisProvider } from "@/lib/ai/provider";

export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_TIMEOUT_MS = 45_000;

export const aiTimeoutMs = () => Number(process.env.AI_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

// Adding a provider means adding one adapter and one line here.
export function selectProvider(): AnalysisProvider | null {
  const provider = process.env.AI_PROVIDER || "gemini";
  const apiKey = process.env.GEMINI_API_KEY;
  if (provider !== "gemini" || !apiKey) return null;
  return createGeminiProvider(apiKey, process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL);
}
