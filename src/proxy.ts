import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_PATH } from "@/lib/auth/redirects";
import { getPublicEnv } from "@/lib/env";
import { sessionCookieOptions } from "@/lib/supabase/cookies";

const PUBLIC_PATHS = ["/login"];

// Refreshes the session and redirects early. Real authorisation happens in requireMember and RLS.
export async function proxy(request: NextRequest) {
  const { url, publishableKey } = getPublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, publishableKey, {
    cookieOptions: sessionCookieOptions,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.includes(pathname);

  const redirectTo = (target: URL) => {
    const redirect = NextResponse.redirect(target);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    for (const header of ["cache-control", "expires", "pragma"]) {
      const value = response.headers.get(header);
      if (value) redirect.headers.set(header, value);
    }
    return redirect;
  };

  if (!signedIn && !isPublic) {
    const target = new URL("/login", request.url);
    if (pathname !== "/") target.searchParams.set("next", `${pathname}${search}`);
    return redirectTo(target);
  }
  if (signedIn && isPublic) return redirectTo(new URL(DEFAULT_PATH, request.url));

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
