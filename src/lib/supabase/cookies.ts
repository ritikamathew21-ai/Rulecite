// Auth runs on the server, so page scripts never need the session token.
// The browser client therefore has no session and acts as an anonymous visitor.
export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
} as const;
