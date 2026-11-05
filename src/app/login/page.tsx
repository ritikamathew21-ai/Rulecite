import type { Metadata } from "next";
import { Wordmark } from "../wordmark";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;

  return (
    <div className="grid flex-1 md:grid-cols-[minmax(16rem,1fr)_2fr]">
      <header className="bg-pencil p-6 text-white md:p-10">
        <Wordmark />
        <p className="mt-3 max-w-xs">Check content against your brand rules before it is published.</p>
      </header>
      <main className="flex items-center p-6 md:p-10">
        <div className="w-full max-w-sm">
          <h1 className="mb-6 text-3xl font-bold">Sign in to Rulecite</h1>
          <LoginForm next={typeof next === "string" ? next : undefined} />
        </div>
      </main>
    </div>
  );
}
