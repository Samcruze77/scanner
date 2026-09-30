// Pre-flight for the sign-up form: tells the browser whether an email address
// is still inside the 24-hour cool-down that follows deleting an account, so
// the form can explain it instead of showing a generic error. The rule itself
// is enforced by a database trigger on auth.users (migration
// 20260930130000_account_deletion_cooldown.sql); this route is only for the
// message. It answers a single boolean and is rate limited.

import { NextResponse } from "next/server";
import { rateLimited } from "@/utils/analytics/proxy.server";

export const runtime = "nodejs";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? "";

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimited(`signup-check:${ip}`, 60_000, 10)) return NextResponse.json({ blocked: false }, { status: 429 });

  let email = "";
  try {
    const body = (await request.json()) as { email?: unknown };
    email = typeof body.email === "string" ? body.email.trim().slice(0, 320) : "";
  } catch {
    return NextResponse.json({ blocked: false }, { status: 400 });
  }
  if (!email || !SUPABASE_URL || !SECRET_KEY) return NextResponse.json({ blocked: false });

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/signup_email_in_cooldown`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SECRET_KEY },
      body: JSON.stringify({ check_email: email }),
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ blocked: false });
    return NextResponse.json({ blocked: (await res.json()) === true });
  } catch {
    // The database trigger still enforces the rule.
    return NextResponse.json({ blocked: false });
  }
}
