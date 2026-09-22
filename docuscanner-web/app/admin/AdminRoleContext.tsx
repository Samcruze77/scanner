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

// Matches the admin-users Edge Function: analyst can view the Users/Live
// sections, but only super_admin/admin can reset a password, suspend, or
// reactivate an account.
export function canManageUsers(role: AdminRole | null): boolean {
  return role === "super_admin" || role === "admin";
}

// Matches admin-users: only super_admin can delete an account or change an
// admin role -- never just hidden in the UI, the Edge Function enforces
// this independently.
export function canDeleteUsers(role: AdminRole | null): boolean {
  return role === "super_admin";
}

export function canManageAdminRoles(role: AdminRole | null): boolean {
  return role === "super_admin";
}

// Matches admin-ads: analyst is read-only for campaigns (they control real
// money-bearing content), only super_admin/admin can create/edit/transition
// them.
export function canManageAds(role: AdminRole | null): boolean {
  return role === "super_admin" || role === "admin";
}
