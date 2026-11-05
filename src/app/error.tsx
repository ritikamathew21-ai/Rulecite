"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 p-6">
      <h1 className="text-3xl font-bold">This page could not load</h1>
      <p>Rulecite could not reach the data for this page. Try again in a moment.</p>
      <button
        type="button"
        onClick={reset}
        className="self-start rounded bg-pencil px-4 py-2 font-bold text-white hover:bg-ink"
      >
        Try again
      </button>
    </main>
  );
}
