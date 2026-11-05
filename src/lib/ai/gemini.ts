import "server-only";
import { ApiError, GoogleGenAI } from "@google/genai";
import { errorFromStatus, ProviderError, type AnalysisProvider } from "@/lib/ai/provider";

const BLOCKED_FINISH_REASONS = /SAFETY|RECITATION|BLOCKLIST|PROHIBITED|SPII/;

export function createGeminiProvider(apiKey: string, model: string): AnalysisProvider {
  // Retries are handled once, in analyzeWithRetry.
  const client = new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } });

  return {
    name: "gemini",
    model,
    async analyze({ system, input, schema, signal }) {
      try {
        const response = await client.models.generateContent({
          model,
          contents: input,
          config: {
            systemInstruction: system,
            responseMimeType: "application/json",
            responseJsonSchema: schema,
            abortSignal: signal,
          },
        });

        const finish = response.candidates?.[0]?.finishReason;
        if (response.promptFeedback?.blockReason || BLOCKED_FINISH_REASONS.test(finish ?? "")) {
          throw new ProviderError("provider_blocked");
        }
        if (finish !== "STOP" || !response.text) throw new ProviderError("invalid_output");
        return response.text;
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        if (signal.aborted) throw new ProviderError("timeout");
        if (error instanceof ApiError) throw errorFromStatus(error.status, error.message);
        throw errorFromStatus(undefined);
      }
    },
  };
}
