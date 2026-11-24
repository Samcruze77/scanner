"use client";

import { usePathname } from "next/navigation";

// usePathname() for navigation UI, with one correction.
//
// The homepage is regenerated in the background (ISR) because the visit counter is cached
// for 10 minutes. On those regenerations Next.js 16.3 renders the page with the pathname
// "/index" instead of "/" (the build-time copy is correct). The browser then hydrates with
// "/", so anything that renders differently for "/" (the Home tab in the phone bottom bar)
// no longer matches the server HTML. React treats that as a hydration error, throws the
// server HTML away and re-creates the page, which also wipes the theme attribute from <html>:
// that is how a chosen Warm Beige or Dark theme turned back into Light on the homepage.
//
// There is no /index route, so mapping it to "/" is always correct.
export function normalizePathname(pathname: string | null): string {
  if (!pathname || pathname === "/index") return "/";
  return pathname;
}

export function usePagePathname(): string {
  return normalizePathname(usePathname());
}
