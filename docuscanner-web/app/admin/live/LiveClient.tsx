"use client";

import { useEffect, useRef, useState } from "react";
import { getAdminLiveBrowser } from "@/utils/admin/live.browser";
import type { AdminLiveResponse } from "@/utils/admin/live";
import { formatLocation } from "@/utils/admin/location";

const POLL_MS = 18_000;

function fmtDate(v: string) {
  return new Date(v).toLocaleTimeString();
}

export function LiveClient({ initial }: { initial: AdminLiveResponse | null }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function poll() {
      try {
        const res = await getAdminLiveBrowser();
        setData(res);
        setError(null);
      } catch {
        setError("Couldn't refresh live data.");
      }
    }
    timer.current = setInterval(poll, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  if (!data) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Couldn&apos;t load live data. Refresh to try again.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Live</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Online = active within the last {data.definitions.online_window_seconds}s. Recently active = within the last{" "}
          {Math.round(data.definitions.recently_active_window_seconds / 60)} minutes. Refreshes automatically every {POLL_MS / 1000}s.
        </p>
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>

      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-3xl font-semibold">{data.online_count}</p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">users online right now</p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Active sessions</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Page / tool</th>
                <th className="px-3 py-2">Activity</th>
                <th className="px-3 py-2">Device</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Last heartbeat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {data.sessions.map((s) => (
                <tr key={s.session_id}>
                  <td className="px-3 py-2">{s.label}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.online ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"}`}>
                      {s.online ? "Online" : "Recently active"}
                    </span>
                  </td>
                  <td className="px-3 py-2">{s.path ?? "—"}{s.tool ? ` (${s.tool})` : ""}</td>
                  <td className="px-3 py-2">{s.activity ?? "—"}</td>
                  <td className="px-3 py-2">{s.device_type ?? "—"} · {s.browser ?? "—"}</td>
                  <td className="px-3 py-2">{formatLocation(s.country_code, s.region)}</td>
                  <td className="px-3 py-2">{fmtDate(s.started_at)}</td>
                  <td className="px-3 py-2">{fmtDate(s.last_seen)}</td>
                </tr>
              ))}
              {data.sessions.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-zinc-400">No active sessions right now.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Live activity</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2">User</th>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Page</th>
                <th className="px-3 py-2">Device</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
              {data.activity.slice(0, 30).map((a, i) => (
                <tr key={i}>
                  <td className="px-3 py-2">{a.label}</td>
                  <td className="px-3 py-2">{a.event_name}</td>
                  <td className="px-3 py-2">{a.path ?? "—"}</td>
                  <td className="px-3 py-2">{a.device_type ?? "—"}</td>
                  <td className="px-3 py-2">{formatLocation(a.country_code, a.region)}</td>
                  <td className="px-3 py-2">{fmtDate(a.created_at)}</td>
                </tr>
              ))}
              {data.activity.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-zinc-400">No recent activity.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
