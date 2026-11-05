export const DEFAULT_PATH = "/workspace";

// Prevents a crafted ?next= link from sending users to another site after sign-in.
export function safeNextPath(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/")) return DEFAULT_PATH;

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return DEFAULT_PATH;
  }

  const unsafe = /^\/[/\\]/.test(decoded) || /[\\\x00-\x1f]/.test(decoded) || /^\/login(?:[/?#]|$)/.test(decoded);
  return unsafe ? DEFAULT_PATH : value;
}
