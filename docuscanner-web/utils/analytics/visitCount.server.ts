// Total visits for the homepage counter: one number from the public_visit_count()
// database function (supabase/migrations/20261123113006_public_visit_count.sql), which
// counts analytics sessions and leaves out administrator traffic. Called from the server
// only (it needs the secret key) and cached for 10 minutes, so the homepage stays static
// and the database is asked at most once per 10 minutes. Returns null when it cannot be
// read; the counter is then simply not shown.

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? "";

export const VISIT_COUNT_REVALIDATE_SECONDS = 600;

export async function getVisitCount(): Promise<number | null> {
  if (!SUPABASE_URL || !SECRET_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/public_visit_count`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SECRET_KEY },
      body: "{}",
      next: { revalidate: VISIT_COUNT_REVALIDATE_SECONDS, tags: ["visit-count"] },
    });
    if (!res.ok) return null;
    const value = Number(await res.json());
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}
