// Server-to-server call to the Supabase analytics Edge Functions, used by the app/api/analytics proxies.

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? "";

export interface EdgeFunctionCallResult {
  ok: boolean;
  status: number;
}

// Server-to-server call, authenticated with the secret key per the
// "auth: 'secret'" mode on the receiving Edge Function. Never throws --
// analytics/presence/ad tracking must always fail silently to the visitor --
// but every failure IS logged server-side (visible in Vercel's function
// logs), because "fail silently to the visitor" previously meant "fail
// silently, period": a missing SUPABASE_SECRET_KEY in this app's Vercel
// environment made every call here a no-op from the very first line below,
// for every event, indefinitely, with nothing anywhere to indicate it.
//
// `visitorUserAgent` is the visitor's own User-Agent. Without it the Edge Function sees
// this server's fetch client instead and classifies every visitor as an "other"
// browser on a desktop, which is how mobile and tablet traffic vanished from the admin
// panel once these proxies replaced the direct browser -> Edge Function calls. Only
// this secret-key-authenticated caller can supply it, same as geo.
export function visitorUserAgent(request: Request): string | null {
  const ua = request.headers.get("user-agent")?.trim();
  return ua ? ua.slice(0, 512) : null;
}

export async function callEdgeFunction(
  slug: string,
  payload: Record<string, unknown>,
  userAgent?: string | null,
): Promise<EdgeFunctionCallResult> {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error(
      `analytics proxy misconfigured: missing ${!SUPABASE_URL ? "SUPABASE_URL" : "SUPABASE_SECRET_KEY"} -- ` +
        `"${slug}" was never called, no event was recorded`,
    );
    return { ok: false, status: 500 };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SECRET_KEY,
        ...(userAgent ? { "User-Agent": userAgent } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) console.error(`analytics proxy: "${slug}" rejected the event (status ${res.status})`);
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.error(`analytics proxy: "${slug}" call failed`, err);
    return { ok: false, status: 502 };
  }
}
