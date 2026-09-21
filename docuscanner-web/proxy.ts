import { type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/middleware";

// Refreshes the Supabase session cookie on (almost) every request. PDFScanner
// is guest-first: this never blocks or redirects unauthenticated visitors --
// it only keeps an existing session's cookies valid so authenticated features
// (save/history/account) don't randomly log the user out mid-session.
export async function proxy(request: NextRequest) {
  return createClient(request);
}

export const config = {
  matcher: [
    // Skip static assets, image optimization, and metadata files so Proxy
    // doesn't run (and doesn't touch cookies) on requests that never need a
    // session -- keeps guest scanning/PDF flows free of any Supabase cost.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
