import { redirect } from "next/navigation";
import { getVerifiedClaims } from "@/utils/supabase/claims";
import { getAdminAnalytics } from "@/utils/admin/client.server";
import { defaultDateRange } from "@/utils/admin/dateRange";
import type { AdminRole } from "@/utils/admin/types";
import { AdminRoleProvider } from "./AdminRoleContext";
import { AdminNav } from "./AdminNav";

const KNOWN_ROLES: AdminRole[] = ["super_admin", "admin", "analyst"];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Cheap guest check first -- no point calling the edge function for
  // visitors who aren't even signed in.
  const { claims } = await getVerifiedClaims();
  if (!claims) {
    redirect("/");
  }

  // There is no separate whoami endpoint. admin-analytics is itself
  // authenticated and checks public.admin_users server-side, and its
  // response carries the caller's role -- that response is the ONLY source
  // of truth for access here. A failed call (network/HTTP error, e.g. the
  // backend rejecting a non-admin caller) or a missing/unrecognized role is
  // treated as "not an admin," never inferred from anything client-side.
  const range = defaultDateRange();
  let role: AdminRole | null = null;
  try {
    const res = await getAdminAnalytics(range.from, range.to);
    role = res?.role ?? null;
  } catch {
    role = null;
  }

  if (!role || !KNOWN_ROLES.includes(role)) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <div>
          <h1 className="text-xl font-semibold">Access restricted</h1>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            This area is limited to PDFScanner admins.
          </p>
        </div>
      </div>
    );
  }

  return (
    <AdminRoleProvider role={role}>
      <div className="flex flex-1 flex-col md:flex-row">
        <AdminNav role={role} />
        <main id="main" className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      </div>
    </AdminRoleProvider>
  );
}
