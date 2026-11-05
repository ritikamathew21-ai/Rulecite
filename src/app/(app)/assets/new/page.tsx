import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/member";
import { AssetForm } from "../asset-form";

export const metadata: Metadata = { title: "Add colour" };

export default async function NewAssetPage() {
  await requireAdmin("/assets");

  return (
    <>
      <h1 className="text-4xl font-bold tracking-tight">Add a brand colour</h1>
      <p className="mt-4 max-w-prose">
        New colours start as drafts. A colour cannot be changed after it is saved, so retire it and add a new one
        instead.
      </p>
      <AssetForm />
    </>
  );
}
