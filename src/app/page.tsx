import { redirect } from "next/navigation";
import { DEFAULT_PATH } from "@/lib/auth/redirects";

export default function Home() {
  redirect(DEFAULT_PATH);
}
