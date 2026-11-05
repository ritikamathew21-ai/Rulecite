import { z } from "zod";

const assetSchema = z.object({
  code: z
    .string({ error: "Enter a colour ID." })
    .trim()
    .regex(/^[A-Z]{2,6}-[0-9]{2,4}$/, "Use a colour ID like CLR-01: capital letters, a hyphen, then numbers."),
  name: z
    .string({ error: "Enter the colour name." })
    .trim()
    .min(1, "Enter the colour name.")
    .max(120, "The colour name must be 120 characters or fewer."),
  value: z
    .string({ error: "Enter the colour value." })
    .trim()
    .toUpperCase()
    .regex(/^#[0-9A-F]{6}$/, "Enter the colour as a hex value like #2340D6."),
});

export type AssetContent = z.output<typeof assetSchema>;

export function parseAsset(values: unknown): { data: AssetContent } | { error: string } {
  const parsed = assetSchema.safeParse(values);
  return parsed.success ? { data: parsed.data } : { error: parsed.error.issues[0].message };
}
