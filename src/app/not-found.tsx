import Link from "next/link";
import { DEFAULT_PATH } from "@/lib/auth/redirects";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p>This page does not exist, or your role cannot view it.</p>
      <Link href={DEFAULT_PATH} className="self-start text-pencil underline">
        Go to your workspace
      </Link>
    </main>
  );
}
