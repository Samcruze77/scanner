// Lets a signed-in user delete their OWN account. Requires the caller's
// session (auth: "user"); the target is always the verified caller, never an
// id from the request. Body must be { "confirm": "DELETE" }.
//
// What happens:
//   1. refuses active admin accounts (those are removed by a super admin via
//      admin-users, which also protects the last super admin);
//   2. removes the user's stored documents from the `documents` bucket;
//   3. records a one-way hash of the email so the address can't be used to
//      sign up again for 24 hours (enforced by a trigger on auth.users, see
//      migration 20260930130000_account_deletion_cooldown.sql);
//   4. deletes the auth user -- documents rows, profile, subscription and
//      usage rows cascade; analytics/ad events keep only anonymous data
//      (their user_id is set to null by the foreign key).
// If step 4 fails the cool-down row is removed again so the user isn't locked out.

import { withSupabase } from "npm:@supabase/server"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

// Must match public.email_cooldown_hash(): sha256 of lower(btrim(email)), hex.
async function emailHash(email: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
    if (req.method !== "POST") return response({ error: "Method not allowed" }, 405)

    const userId = ctx.userClaims?.id
    if (!userId) return response({ error: "Unauthorized" }, 401)

    let body: { confirm?: unknown }
    try {
      body = await req.json()
    } catch {
      return response({ error: "Invalid request" }, 400)
    }
    if (body.confirm !== "DELETE") return response({ error: "Type DELETE to confirm" }, 400)

    const admin = ctx.supabaseAdmin

    const { data: adminRow } = await admin.from("admin_users").select("is_active").eq("user_id", userId).maybeSingle()
    if (adminRow?.is_active) {
      return response({ error: "Administrator accounts can't be deleted here. Ask a super admin to remove your admin role first." }, 403)
    }

    const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId)
    const email = userData?.user?.email
    if (userError || !userData?.user) return response({ error: "Account not found" }, 404)

    // 1. Stored documents (files in storage; rows cascade with the user).
    const { data: docs } = await admin.from("documents").select("storage_path").eq("user_id", userId)
    const paths = (docs ?? []).map((d: { storage_path: string | null }) => d.storage_path).filter(Boolean) as string[]
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await admin.storage.from("documents").remove(paths.slice(i, i + 100))
      if (error) return response({ error: "Couldn't remove your saved documents. Nothing was deleted; please try again." }, 500)
    }

    // 2. Re-signup cool-down (one-way hash only).
    let hash: string | null = null
    if (email) {
      hash = await emailHash(email)
      const { error } = await admin.from("deleted_account_cooldowns").upsert({ email_hash: hash, deleted_at: new Date().toISOString() })
      if (error) return response({ error: "Couldn't delete your account. Please try again." }, 500)
    }

    // 3. The account itself.
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId)
    if (deleteError) {
      if (hash) await admin.from("deleted_account_cooldowns").delete().eq("email_hash", hash)
      return response({ error: "Couldn't delete your account. Please try again." }, 500)
    }

    return response({ ok: true, can_sign_up_again_after: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })
  }),
}
