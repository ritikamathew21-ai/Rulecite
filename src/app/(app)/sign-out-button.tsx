import { logout } from "@/lib/auth/actions";

export function SignOutButton() {
  return (
    <form action={logout}>
      <button type="submit" className="rounded border border-muted px-3 py-1.5 font-bold hover:border-ink">
        Sign out
      </button>
    </form>
  );
}
