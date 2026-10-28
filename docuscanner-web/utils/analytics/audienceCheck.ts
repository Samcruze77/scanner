// Pure helpers for the audience probe (app/api/analytics/audience/route.ts).

// Every role that can sign in to the admin area counts as an administrator.
const ADMIN_ROLES = ["super_admin", "admin", "analyst"];

export function isAdminRole(role: unknown): boolean {
  return typeof role === "string" && ADMIN_ROLES.includes(role);
}

// supabase-js reports a non-2xx Edge Function answer as an error whose `context` is the
// Response. 403 is admin-analytics' answer for a signed-in caller who is not an admin.
export function isForbiddenError(err: unknown): boolean {
  const context = (err as { context?: { status?: unknown } } | null)?.context;
  return typeof context?.status === "number" && (context.status === 403 || context.status === 401);
}
