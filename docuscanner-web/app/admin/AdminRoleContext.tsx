"use client";

import { createContext, useContext } from "react";
import type { AdminRole } from "@/utils/admin/types";

const AdminRoleContext = createContext<AdminRole | null>(null);

export function AdminRoleProvider({
  role,
  children,
}: {
  role: AdminRole;
  children: React.ReactNode;
}) {
  return <AdminRoleContext.Provider value={role}>{children}</AdminRoleContext.Provider>;
}

export function useAdminRole(): AdminRole | null {
  return useContext(AdminRoleContext);
}

// Only super_admin/admin may trigger exports (CSV/PDF/email); analyst is
// read-only on the dashboard. Adjust here if the real policy differs.
export function canManageExports(role: AdminRole | null): boolean {
  return role === "super_admin" || role === "admin";
}
