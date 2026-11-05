import type { Metadata } from "next";
import { requireMember } from "@/lib/auth/member";

export const metadata: Metadata = { title: "AI and data" };

export default async function TrustPage() {
  await requireMember();

  return (
    <div className="max-w-prose">
      <h1 className="text-4xl font-bold tracking-tight">AI and data</h1>

      <h2 className="mt-8 text-xl font-bold">AI checks are not active yet</h2>
      <p className="mt-2">
        Rulecite does not send anything to an AI service today. When AI checks are added, they will use the Google
        Gemini API free tier.
      </p>

      <h2 className="mt-8 text-xl font-bold">What will happen to AI-checked text</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>The draft and the relevant brand rules will be sent to Google.</li>
        <li>On the free tier, Google may use this content to improve its products.</li>
        <li>Human reviewers at Google may read it.</li>
        <li>Only fictional or synthetic content may be checked with AI.</li>
      </ul>

      <h2 className="mt-8 text-xl font-bold">Where your data is stored</h2>
      <p className="mt-2">
        Accounts and workspace data are stored with Supabase in Singapore. Each organisation&apos;s data is separated
        by database access rules.
      </p>

      <h2 className="mt-8 text-xl font-bold">People stay in charge</h2>
      <p className="mt-2">
        Rulecite will suggest changes and explain them. It will not change content or approve it on its own.
      </p>
    </div>
  );
}
