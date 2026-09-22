"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { getAdminUsersBrowser } from "@/utils/admin/users.browser";
import type { AdminUsersListResponse, AdminUsersListFilters } from "@/utils/admin/users";

function fmtDate(v: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleString();
}

function StatusBadge({ user }: { user: AdminUsersListResponse["users"][number] }) {
  if (user.is_suspended) {
    return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">Suspended</span>;
  }
  if (user.online) {
    return <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-950 dark:text-green-300">Online</span>;
  }
  if (user.recently_active) {
    return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">Recently active</span>;
  }
  return <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">Inactive</span>;
}

export function UsersClient({ initial }: { initial: AdminUsersListResponse | null }) {
  const [data, setData] = useState(initial);
  const [q, setQ] = useState("");
  const [verified, setVerified] = useState<AdminUsersListFilters["verified"] | "">("");
  const [activityState, setActivityState] = useState<AdminUsersListFilters["activity_state"] | "">("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reload(filters: AdminUsersListFilters) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await getAdminUsersBrowser({ ...filters, limit: 50 });
        setData(res);
      } catch {
        setError("Couldn't load users.");
      }
    });
  }

  function applyFilters() {
    reload({
      q: q || undefined,
      verified: verified || undefined,
      activity_state: activityState || undefined,
    });
  }

  if (!data) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Couldn&apos;t load users. Refresh to try again.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-semibold">Users</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{data.total} total</p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Search</span>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            placeholder="email or name"
            className="w-48 rounded-md border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-800 dark:bg-black"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Verified</span>
          <select
            value={verified}
            onChange={(e) => setVerified(e.target.value as typeof verified)}
            className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-800 dark:bg-black"
          >
            <option value="">Any</option>
            <option value="true">Verified</option>
            <option value="false">Unverified</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Activity</span>
          <select
            value={activityState}
            onChange={(e) => setActivityState(e.target.value as typeof activityState)}
            className="rounded-md border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-800 dark:bg-black"
          >
            <option value="">Any</option>
            <option value="online">Online now</option>
            <option value="recent">Recently active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
        <button
          type="button"
          onClick={applyFilters}
          className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-black"
        >
          Apply
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {isPending && <p className="text-sm text-zinc-400">Loading…</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Signed up</th>
              <th className="px-3 py-2">Last seen</th>
              <th className="px-3 py-2">Scans</th>
              <th className="px-3 py-2">Conversions</th>
              <th className="px-3 py-2">Downloads</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {data.users.map((u) => (
              <tr key={u.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-950">
                <td className="px-3 py-2">
                  <Link href={`/admin/users/${u.id}`} className="font-medium hover:underline">
                    {u.display_name || u.email || u.id}
                  </Link>
                  {u.display_name && <p className="text-xs text-zinc-500 dark:text-zinc-400">{u.email}</p>}
                  {!u.email_confirmed_at && <p className="text-xs text-amber-600 dark:text-amber-400">Unverified</p>}
                </td>
                <td className="px-3 py-2"><StatusBadge user={u} /></td>
                <td className="px-3 py-2 capitalize text-zinc-600 dark:text-zinc-400">{u.admin_role?.replace("_", " ") ?? "—"}</td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{fmtDate(u.created_at)}</td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{fmtDate(u.last_activity_at)}</td>
                <td className="px-3 py-2">{u.scans}</td>
                <td className="px-3 py-2">{u.conversions}</td>
                <td className="px-3 py-2">{u.downloads}</td>
              </tr>
            ))}
            {data.users.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-zinc-400">No users match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
