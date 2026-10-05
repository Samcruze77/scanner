
// Super Admin user-management API. GET lists/searches users or returns one
// user's detail; POST performs privileged account actions. Every write is
// gated on public.admin_users (checked server-side via the service-role
// client, exactly like admin-analytics) and every privileged action writes
// an admin_audit_logs row.
//
// Authorization model (fail closed):
//   - No valid session                          -> 401
//   - Session valid, no active admin_users row   -> 403
//   - Read (GET)                                 -> super_admin | admin | analyst
//   - reset_password / suspend / reactivate      -> super_admin | admin
//   - delete / set_role                          -> super_admin only
// A caller can never target their own account for suspend/delete/set_role,
// and the last active super_admin can never be suspended, deleted, or
// demoted -- both enforced here, not just hidden in the UI.

import { withSupabase } from "npm:@supabase/server"
import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

const ONLINE_WINDOW_MS = 90 * 1000
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const ALLOWED_ROLES = new Set(["super_admin", "admin", "analyst"])
const ALLOWED_REDIRECT_ORIGINS = new Set([
  "https://freepdfscanner.com",
  "https://www.freepdfscanner.com",
])

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

async function writeAudit(
  admin: ReturnType<typeof createClient>,
  adminUserId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown>,
) {
  await admin.from("admin_audit_logs").insert({
    admin_user_id: adminUserId,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata,
  })
}

async function activeSuperAdminCount(admin: ReturnType<typeof createClient>): Promise<number> {
  const { count } = await admin
    .from("admin_users")
    .select("user_id", { count: "exact", head: true })
    .eq("role", "super_admin")
    .eq("is_active", true)
  return count ?? 0
}

async function listAllAuthUsers(admin: ReturnType<typeof createClient>) {
  const users: Array<{
    id: string
    email: string | null
    email_confirmed_at: string | null
    created_at: string
    last_sign_in_at: string | null
    banned_until: string | null
    raw_user_meta_data: Record<string, unknown> | null
  }> = []
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) break
    users.push(...(data.users as typeof users))
    if (data.users.length < 1000) break
  }
  return users
}

export default {
  fetch: withSupabase({ auth: "user" }, async (req, ctx) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

    // @supabase/server exposes the verified user id as ctx.userClaims.id,
    // not .sub (the raw JWT claim name) -- see admin-analytics for the
    // fuller note on how this was confirmed.
    const userId = ctx.userClaims?.id
    if (!userId) return response({ error: "Unauthorized" }, 401)

    const { data: adminRow, error: adminError } = await ctx.supabaseAdmin
      .from("admin_users")
      .select("role,is_active")
      .eq("user_id", userId)
      .maybeSingle()

    if (adminError || !adminRow?.is_active) return response({ error: "Forbidden" }, 403)
    const role = adminRow.role as "super_admin" | "admin" | "analyst"

    const admin = serviceClient()

    if (req.method === "GET") {
      const url = new URL(req.url)
      const id = url.searchParams.get("id")
      const scope = url.searchParams.get("scope")

      // Only-intentionally-stored documents, across every user -- never
      // anything browser-local. Read-only for all three roles.
      if (scope === "documents") {
        const { data: documents } = await admin
          .from("documents")
          .select("id,user_id,title,file_size,page_count,mime_type,created_at")
          .order("created_at", { ascending: false })
          .limit(500)
        const userIds = [...new Set((documents ?? []).map((d) => d.user_id))]
        const { data: profiles } = await admin.from("user_profiles").select("user_id,display_name").in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"])
        const nameByUser = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name]))
        return response({
          role,
          documents: (documents ?? []).map((d) => ({ ...d, owner_label: nameByUser.get(d.user_id) ?? d.user_id })),
        })
      }

      // Admin audit trail. Read-only for all three roles (visibility into
      // what other admins have done is itself a legitimate oversight need).
      if (scope === "audit") {
        const { data: logs } = await admin
          .from("admin_audit_logs")
          .select("id,admin_user_id,action,target_type,target_id,metadata,created_at")
          .order("created_at", { ascending: false })
          .limit(500)
        const adminIds = [...new Set((logs ?? []).map((l) => l.admin_user_id).filter(Boolean))] as string[]
        const emailById = new Map<string, string>()
        for (const uid of adminIds) {
          const { data } = await admin.auth.admin.getUserById(uid)
          if (data?.user?.email) emailById.set(uid, data.user.email)
        }
        return response({
          role,
          logs: (logs ?? []).map((l) => ({ ...l, admin_label: l.admin_user_id ? (emailById.get(l.admin_user_id) ?? l.admin_user_id) : "Unknown" })),
        })
      }

      const authUsers = await listAllAuthUsers(admin)

      const [{ data: profiles }, { data: adminRows }, { data: sessions }] = await Promise.all([
        admin.from("user_profiles").select("user_id,display_name"),
        admin.from("admin_users").select("user_id,role,is_active"),
        admin.from("live_sessions").select("user_id,session_id,path,tool,activity,device_type,browser,operating_system,country_code,region,started_at,last_seen"),
      ])

      // analytics_events is large; fetch only the columns needed for
      // per-user aggregation, same in-memory-reduce style as admin-analytics.
      const { data: events } = await admin
        .from("analytics_events")
        .select("user_id,event_name,created_at")
        .not("user_id", "is", null)
        .limit(200000)

      const profileByUser = new Map((profiles ?? []).map((p) => [p.user_id, p]))
      const adminByUser = new Map((adminRows ?? []).map((a) => [a.user_id, a]))
      const sessionByUser = new Map((sessions ?? []).filter((s) => s.user_id).map((s) => [s.user_id as string, s]))

      const usageByUser = new Map<string, { scans: number; conversions: number; downloads: number; lastActivityAt: string | null }>()
      for (const ev of events ?? []) {
        const uid = ev.user_id as string
        let entry = usageByUser.get(uid)
        if (!entry) {
          entry = { scans: 0, conversions: 0, downloads: 0, lastActivityAt: null }
          usageByUser.set(uid, entry)
        }
        if (ev.event_name === "scan_completed") entry.scans += 1
        if (ev.event_name === "conversion_completed") entry.conversions += 1
        if (ev.event_name === "document_downloaded") entry.downloads += 1
        if (!entry.lastActivityAt || ev.created_at > entry.lastActivityAt) entry.lastActivityAt = ev.created_at
      }

      const now = Date.now()
      function toRow(u: (typeof authUsers)[number]) {
        const usage = usageByUser.get(u.id)
        const session = sessionByUser.get(u.id)
        const lastSeenMs = session ? new Date(session.last_seen).getTime() : null
        const online = lastSeenMs !== null && now - lastSeenMs <= ONLINE_WINDOW_MS
        const lastActivityAt = usage?.lastActivityAt ?? session?.last_seen ?? null
        const lastActivityMs = lastActivityAt ? new Date(lastActivityAt).getTime() : null
        const recentlyActive = !online && lastActivityMs !== null && now - lastActivityMs <= RECENT_WINDOW_MS
        return {
          id: u.id,
          email: u.email,
          display_name: profileByUser.get(u.id)?.display_name ?? null,
          email_confirmed_at: u.email_confirmed_at,
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          banned_until: u.banned_until,
          is_suspended: !!u.banned_until && new Date(u.banned_until).getTime() > now,
          admin_role: adminByUser.get(u.id)?.is_active ? adminByUser.get(u.id)!.role : null,
          scans: usage?.scans ?? 0,
          conversions: usage?.conversions ?? 0,
          downloads: usage?.downloads ?? 0,
          last_activity_at: lastActivityAt,
          online,
          recently_active: recentlyActive,
        }
      }

      if (id) {
        const authUser = authUsers.find((u) => u.id === id)
        if (!authUser) return response({ error: "Not found" }, 404)

        const [{ data: documents }, { data: recentEvents }] = await Promise.all([
          admin.from("documents").select("id,title,file_size,page_count,mime_type,created_at").eq("user_id", id).order("created_at", { ascending: false }),
          admin.from("analytics_events").select("event_name,path,properties,created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(50),
        ])

        const session = sessionByUser.get(id) ?? null
        return response({
          role,
          user: toRow(authUser),
          session: session
            ? {
                online: now - new Date(session.last_seen).getTime() <= ONLINE_WINDOW_MS,
                path: session.path,
                tool: session.tool,
                activity: session.activity,
                device_type: session.device_type,
                browser: session.browser,
                operating_system: session.operating_system,
                country_code: session.country_code,
                region: session.region,
                started_at: session.started_at,
                last_seen: session.last_seen,
              }
            : null,
          documents: documents ?? [],
          recent_events: recentEvents ?? [],
        })
      }

      const q = (url.searchParams.get("q") ?? "").trim().toLowerCase()
      const verified = url.searchParams.get("verified")
      const activityState = url.searchParams.get("activity_state")
      const signupFrom = url.searchParams.get("signup_from")
      const signupTo = url.searchParams.get("signup_to")
      const activityType = url.searchParams.get("activity_type")
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50"), 1), 200)
      const offset = Math.max(Number(url.searchParams.get("offset") ?? "0"), 0)

      let rows = authUsers.map(toRow)

      if (q) {
        rows = rows.filter((r) => r.email?.toLowerCase().includes(q) || r.display_name?.toLowerCase().includes(q))
      }
      if (verified === "true") rows = rows.filter((r) => !!r.email_confirmed_at)
      if (verified === "false") rows = rows.filter((r) => !r.email_confirmed_at)
      if (activityState === "online") rows = rows.filter((r) => r.online)
      if (activityState === "recent") rows = rows.filter((r) => r.recently_active)
      if (activityState === "inactive") rows = rows.filter((r) => !r.online && !r.recently_active)
      if (signupFrom) rows = rows.filter((r) => r.created_at >= signupFrom)
      if (signupTo) rows = rows.filter((r) => r.created_at <= signupTo)
      if (activityType === "scans") rows = rows.filter((r) => r.scans > 0)
      if (activityType === "conversions") rows = rows.filter((r) => r.conversions > 0)
      if (activityType === "downloads") rows = rows.filter((r) => r.downloads > 0)

      rows.sort((a, b) => (b.created_at > a.created_at ? 1 : -1))
      const total = rows.length
      const page = rows.slice(offset, offset + limit)

      return response({ role, users: page, total })
    }

    if (req.method !== "POST") return response({ error: "Method not allowed" }, 405)

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return response({ error: "Invalid JSON" }, 400)
    }

    const action = typeof body.action === "string" ? body.action : ""
    const targetId = typeof body.user_id === "string" ? body.user_id : ""
    if (!targetId) return response({ error: "user_id is required" }, 400)

    const { data: targetAdminRow } = await admin
      .from("admin_users")
      .select("role,is_active")
      .eq("user_id", targetId)
      .maybeSingle()
    const targetIsSuperAdmin = targetAdminRow?.is_active && targetAdminRow.role === "super_admin"

    async function wouldRemoveLastSuperAdmin() {
      if (!targetIsSuperAdmin) return false
      const count = await activeSuperAdminCount(admin)
      return count <= 1
    }

    if (action === "reset_password") {
      if (role !== "super_admin" && role !== "admin") return response({ error: "Forbidden" }, 403)

      const { data: targetUser } = await admin.auth.admin.getUserById(targetId)
      const email = targetUser?.user?.email
      if (!email) {
        await writeAudit(admin, userId, "password_reset_initiated", "user", targetId, { success: false, reason: "user_not_found" })
        return response({ error: "User not found" }, 404)
      }

      const origin = typeof body.origin === "string" && ALLOWED_REDIRECT_ORIGINS.has(body.origin) ? body.origin : "https://www.freepdfscanner.com"
      const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/reset-password` })

      await writeAudit(admin, userId, "password_reset_initiated", "user", targetId, { success: !error, email })
      if (error) return response({ error: "Unable to send reset email" }, 500)
      return response({ ok: true })
    }

    if (action === "suspend") {
      if (role !== "super_admin" && role !== "admin") return response({ error: "Forbidden" }, 403)
      if (targetId === userId) return response({ error: "You cannot suspend your own account" }, 400)
      if (await wouldRemoveLastSuperAdmin()) return response({ error: "Cannot suspend the last active Super Admin" }, 400)

      const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : null
      const { error } = await admin.auth.admin.updateUserById(targetId, { ban_duration: "876000h" })

      await writeAudit(admin, userId, "account_suspended", "user", targetId, { success: !error, reason })
      if (error) return response({ error: "Unable to suspend account" }, 500)
      return response({ ok: true })
    }

    if (action === "reactivate") {
      if (role !== "super_admin" && role !== "admin") return response({ error: "Forbidden" }, 403)

      const { error } = await admin.auth.admin.updateUserById(targetId, { ban_duration: "none" })

      await writeAudit(admin, userId, "account_reactivated", "user", targetId, { success: !error })
      if (error) return response({ error: "Unable to reactivate account" }, 500)
      return response({ ok: true })
    }

    if (action === "delete") {
      if (role !== "super_admin") return response({ error: "Forbidden" }, 403)
      if (targetId === userId) return response({ error: "You cannot delete your own account" }, 400)
      if (body.confirm !== true) return response({ error: "Deletion requires explicit confirmation" }, 400)
      if (await wouldRemoveLastSuperAdmin()) return response({ error: "Cannot delete the last active Super Admin" }, 400)

      const { data: targetUser } = await admin.auth.admin.getUserById(targetId)
      const email = targetUser?.user?.email ?? null

      const { data: docs } = await admin.from("documents").select("storage_path").eq("user_id", targetId)
      const paths = (docs ?? []).map((d) => d.storage_path).filter(Boolean) as string[]
      if (paths.length > 0) {
        await admin.storage.from("documents").remove(paths)
      }

      const { error } = await admin.auth.admin.deleteUser(targetId)

      await writeAudit(admin, userId, "account_deleted", "user", targetId, {
        success: !error,
        email,
        documents_removed: paths.length,
      })
      if (error) return response({ error: "Unable to delete account" }, 500)
      return response({ ok: true })
    }

    if (action === "set_role") {
      if (role !== "super_admin") return response({ error: "Forbidden" }, 403)
      if (targetId === userId) return response({ error: "You cannot change your own admin role" }, 400)

      const newRole = body.role === null ? null : typeof body.role === "string" ? body.role : undefined
      if (newRole !== null && (!newRole || !ALLOWED_ROLES.has(newRole))) {
        return response({ error: "Invalid role" }, 400)
      }
      if (await wouldRemoveLastSuperAdmin() && newRole !== "super_admin") {
        return response({ error: "Cannot remove the last active Super Admin" }, 400)
      }

      const oldRole = targetAdminRow?.is_active ? targetAdminRow.role : null
      let error: { message: string } | null = null

      if (newRole === null) {
        ;({ error } = await admin.from("admin_users").delete().eq("user_id", targetId))
      } else if (targetAdminRow) {
        ;({ error } = await admin.from("admin_users").update({ role: newRole, is_active: true }).eq("user_id", targetId))
      } else {
        const { data: targetUser } = await admin.auth.admin.getUserById(targetId)
        ;({ error } = await admin.from("admin_users").insert({
          user_id: targetId,
          role: newRole,
          display_name: targetUser?.user?.email ?? null,
          is_active: true,
        }))
      }

      await writeAudit(admin, userId, "admin_role_changed", "user", targetId, { success: !error, old_role: oldRole, new_role: newRole })
      if (error) return response({ error: "Unable to update role" }, 500)
      return response({ ok: true })
    }

    return response({ error: "Unknown action" }, 400)
  }),
}
