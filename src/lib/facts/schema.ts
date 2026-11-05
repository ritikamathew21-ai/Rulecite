import { z } from "zod";

export const factCodeSchema = z
  .string({ error: "Enter a fact ID." })
  .trim()
  .regex(/^[A-Z]{2,6}-[0-9]{2,4}$/, "Use a fact ID like FACT-07: capital letters, a hyphen, then numbers.");

const text = (label: string, max: number) =>
  z
    .string({ error: `Enter the ${label}.` })
    .trim()
    .min(1, `Enter the ${label}.`)
    .max(max, `The ${label} must be ${max} characters or fewer.`);

const factSchema = z
  .object({
    statement: text("approved statement", 1000),
    sourceName: text("source name", 200),
    sourceUrl: z
      .string()
      .trim()
      .max(500, "The source link must be 500 characters or fewer.")
      .regex(/^(https?:\/\/\S+)?$/, "The source link must start with http:// or https://.")
      .optional(),
    validFrom: z.iso.date({ error: "Enter the date this fact starts." }),
    expiresOn: z.union([z.literal(""), z.iso.date({ error: "Enter a valid expiry date." })]).optional(),
  })
  .refine(({ validFrom, expiresOn }) => !expiresOn || expiresOn >= validFrom, {
    error: "The expiry date cannot be before the start date.",
  })
  .transform(({ statement, sourceName, sourceUrl, validFrom, expiresOn }) => ({
    statement,
    source_name: sourceName,
    source_url: sourceUrl || null,
    valid_from: validFrom,
    expires_on: expiresOn || null,
  }));

export type FactContent = z.output<typeof factSchema>;

export function parseFact(values: unknown): { data: FactContent } | { error: string } {
  const parsed = factSchema.safeParse(values);
  return parsed.success ? { data: parsed.data } : { error: parsed.error.issues[0].message };
}

// The en-CA locale gives YYYY-MM-DD, which compares correctly as text.
export const todayInIndia = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);

export type FactValidity = "not_yet_valid" | "current" | "expired";

// A fact applies from its start date through its expiry date, inclusive.
export function factValidity(validFrom: string, expiresOn: string | null, today: string): FactValidity {
  if (today < validFrom) return "not_yet_valid";
  return expiresOn && expiresOn < today ? "expired" : "current";
}
