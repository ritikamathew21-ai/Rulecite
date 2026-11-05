import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DEFAULT_PATH } from "@/lib/auth/redirects";
import { requireSignedIn } from "@/lib/auth/member";
import { SignOutButton } from "../(app)/sign-out-button";

export const metadata: Metadata = { title: "No access" };

export default async function NoAccessPage() {
  const { member } = await requireSignedIn();
  if (member) redirect(DEFAULT_PATH);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="text-3xl font-bold">No organisation access</h1>
      <p>Your account is not a member of any organisation. Ask an administrator to add you.</p>
      <div>
        <SignOutButton />
      </div>
    </main>
  );
}
