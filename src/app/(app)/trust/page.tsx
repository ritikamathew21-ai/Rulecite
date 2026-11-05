import type { Metadata } from "next";
import { requireMember } from "@/lib/auth/member";

export const metadata: Metadata = { title: "AI and data" };

export default async function TrustPage() {
  await requireMember();

  return (
    <div className="max-w-prose">
      <h1 className="text-4xl font-bold tracking-tight">AI and data</h1>

      <h2 className="mt-8 text-xl font-bold">How AI checks work</h2>
      <p className="mt-2">
        Rulecite uses the Google Gemini API free tier to review tone, messaging and claims. It runs only on content you
        mark as fictional or synthetic. Everything else gets code checks only.
      </p>

      <h2 className="mt-8 text-xl font-bold">What happens to AI-checked text</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>The draft, your tone, messaging and claim rules, and your approved facts are sent to Google.</li>
        <li>On the free tier, Google may use this content to improve its products.</li>
        <li>Human reviewers at Google may read it.</li>
        <li>Do not submit real, confidential or personal content.</li>
      </ul>

      <h2 className="mt-8 text-xl font-bold">Where your data is stored and processed</h2>
      <p className="mt-2">
        Accounts and workspace data are stored with Supabase in Singapore. Each organisation&apos;s data is separated
        by database access rules.
      </p>
      <p className="mt-2">
        The app is hosted on Vercel. Requests currently reach a Vercel server in Mumbai and are processed in the
        United States, which then reads and writes your data in Singapore.
      </p>

      <h2 className="mt-8 text-xl font-bold">People stay in charge</h2>
      <p className="mt-2">
        Rulecite suggests changes and explains them. It does not change content or approve it on its own. AI findings can be
        wrong, and each one is labelled so you can tell it apart from a rule-based finding.
      </p>
    </div>
  );
}
