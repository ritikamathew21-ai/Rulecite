import { logout } from "@/lib/auth/actions";

export function SignOutButton() {
  return (
    <form action={logout}>
      <button type="submit" className="rounded-md border border-current/30 px-3 py-2">
        Sign out
      </button>
    </form>
  );
}
