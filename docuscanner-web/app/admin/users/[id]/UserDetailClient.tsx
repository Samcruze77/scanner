"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { createClient as createBrowserClient } from "@/utils/supabase/client";
import { getAdminUserDetailBrowser, postAdminUserActionBrowser } from "@/utils/admin/users.browser";
import type { AdminUserDetailResponse } from "@/utils/admin/users";
import { formatLocation } from "@/utils/admin/location";
import { canDeleteUsers, canManageAdminRoles, canManageUsers, useAdminRole } from "../../AdminRoleContext";

function fmtDate(v: string | null) {
  if (!v) return "—";
  return new Date(v).toLocaleString();
}
function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function UserDetailClient({ id, initial }: { id: string; initial: AdminUserDetailResponse }) {
  const role = useAdminRole();
  const [data, setData] = useState(initial);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    createBrowserClient()
      .auth.getUser()
      .then(({ data }) => setSelfId(data.user?.id ?? null))
      .catch(() => {});
  }, []);

  function refresh() {
    startTransition(async () => {
      try {
        setData(await getAdminUserDetailBrowser(id));
      } catch {
        // keep showing stale data rather than blank the page
      }
    });
  }

  async function runAction(fn: () => Promise<{ ok: true }>, successMessage: string) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        await fn();
        setMessage(successMessage);
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
      }
    });
  }

  const u = data.user;
  const isSelf = selfId === id;
  const canManage = canManageUsers(role);
  const canDelete = canDeleteUsers(role);
  const canSetRole = canManageAdminRoles(role);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/admin/users" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">
          ← Users
        </Link>
        <h1 className="mt-1 text-lg font-semibold">{u.display_name || u.email || u.id}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{u.email}</p>
      </div>

      {message && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">{message}</p>}
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="mb-2 text-sm font-semibold">Account</h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-zinc-500">Verification</dt><dd>{u.email_confirmed_at ? "Verified" : "Unverified"}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Status</dt><dd>{u.is_suspended ? "Suspended" : "Active"}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Signed up</dt><dd>{fmtDate(u.created_at)}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Last login</dt><dd>{fmtDate(u.last_sign_in_at)}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Last seen</dt><dd>{fmtDate(u.last_activity_at)}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Account ID</dt><dd className="font-mono text-xs">{u.id}</dd></div>
          </dl>
        </div>

        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="mb-2 text-sm font-semibold">Usage</h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-zinc-500">Scans</dt><dd>{u.scans}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Conversions</dt><dd>{u.conversions}</dd></div>
            <div className="flex justify-between"><dt className="text-zinc-500">Downloads</dt><dd>{u.downloads}</dd></div>
          </dl>
        </div>

        <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800 sm:col-span-2">
          <h2 className="mb-2 text-sm font-semibold">Current session</h2>
          {data.session ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              <div className="flex justify-between"><dt className="text-zinc-500">Status</dt><dd>{data.session.online ? "Online" : "Offline"}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-500">Page</dt><dd>{data.session.path ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-500">Tool</dt><dd>{data.session.tool ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-500">Activity</dt><dd>{data.session.activity ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-500">Device</dt><dd>{data.session.device_type ?? "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-500">Location</dt><dd>{formatLocation(data.session.country_code, data.session.region)}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-500">Started</dt><dd>{fmtDate(data.session.started_at)}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-500">Last heartbeat</dt><dd>{fmtDate(data.session.last_seen)}</dd></div>
            </dl>
          ) : (
            <p className="text-sm text-zinc-400">No session in the last 15 minutes.</p>
          )}
        </div>
      </section>

      {canManage && (
        <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="mb-3 text-sm font-semibold">Account actions</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                runAction(
                  () => postAdminUserActionBrowser({ action: "reset_password", user_id: id, origin: window.location.origin }),
                  "Password reset email sent.",
                )
              }
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium dark:border-zinc-800"
            >
              Reset password
            </button>

            {u.is_suspended ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => runAction(() => postAdminUserActionBrowser({ action: "reactivate", user_id: id }), "Account reactivated.")}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium dark:border-zinc-800"
              >
                Reactivate
              </button>
            ) : (
              <button
                type="button"
                disabled={isPending || isSelf}
                title={isSelf ? "You cannot suspend your own account" : undefined}
                onClick={() => runAction(() => postAdminUserActionBrowser({ action: "suspend", user_id: id }), "Account suspended.")}
                className="rounded-md border border-amber-300 px-3 py-1.5 text-sm font-medium text-amber-700 disabled:opacity-40 dark:border-amber-800 dark:text-amber-400"
              >
                Suspend
              </button>
            )}

            {canDelete && (
              <>
                {!confirmDelete ? (
                  <button
                    type="button"
                    disabled={isPending || isSelf}
                    title={isSelf ? "You cannot delete your own account" : undefined}
                    onClick={() => setConfirmDelete(true)}
                    className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-40 dark:border-red-800 dark:text-red-400"
                  >
                    Delete account
                  </button>
                ) : (
                  <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-1.5 dark:bg-red-950">
                    <span className="text-sm text-red-700 dark:text-red-300">Permanently delete this account and their stored documents?</span>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        setConfirmDelete(false);
                        runAction(() => postAdminUserActionBrowser({ action: "delete", user_id: id, confirm: true }), "Account deleted.");
                      }}
                      className="rounded-md bg-red-600 px-2 py-1 text-xs font-semibold text-white"
                    >
                      Confirm delete
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(false)} className="text-xs text-zinc-500 hover:underline">
                      Cancel
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {canSetRole && (
            <div className="mt-4 flex items-center gap-2">
              <label className="text-sm text-zinc-500 dark:text-zinc-400">Admin role</label>
              <select
                defaultValue={u.admin_role ?? ""}
                disabled={isPending || isSelf}
                onChange={(e) => {
                  const value = e.target.value;
                  runAction(
                    () =>
                      postAdminUserActionBrowser({
                        action: "set_role",
                        user_id: id,
                        role: (value || null) as "super_admin" | "admin" | "analyst" | null,
                      }),
                    "Role updated.",
                  );
                }}
                className="rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-black"
              >
                <option value="">Not an admin</option>
                <option value="analyst">Analyst</option>
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>
              {isSelf && <span className="text-xs text-zinc-400">You cannot change your own role</span>}
            </div>
          )}
        </section>
      )}

      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="mb-2 text-sm font-semibold">Stored documents</h2>
        <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
          Only documents this user chose to save to their account. Browser-only scans never appear here.
        </p>
        {data.documents.length === 0 ? (
          <p className="text-sm text-zinc-400">No stored documents.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-900">
            {data.documents.map((d) => (
              <li key={d.id} className="flex justify-between py-1.5">
                <span>{d.title}</span>
                <span className="text-zinc-500">{fmtBytes(d.file_size)} · {fmtDate(d.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="mb-2 text-sm font-semibold">Recent activity</h2>
        {data.recent_events.length === 0 ? (
          <p className="text-sm text-zinc-400">No recorded activity.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-900">
            {data.recent_events.map((e, i) => (
              <li key={i} className="flex justify-between py-1.5">
                <span>{e.event_name}{e.path ? ` · ${e.path}` : ""}</span>
                <span className="text-zinc-500">{fmtDate(e.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
