"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  getAdCampaignsBrowser,
  duplicateCampaignBrowser,
  setCampaignStatusBrowser,
  deleteCampaignBrowser,
} from "@/utils/admin/ads.browser";
import type { AdCampaignsListResponse, CampaignStatus } from "@/utils/admin/ads";
import { canManageAds, useAdminRole } from "../AdminRoleContext";

const STATE_STYLE: Record<string, string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  scheduled: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  paused: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  draft: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
  completed: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
  archived: "bg-zinc-100 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600",
};

export function AdsClient({ initial }: { initial: AdCampaignsListResponse | null }) {
  const role = useAdminRole();
  const canManage = canManageAds(role);
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reload() {
    startTransition(async () => {
      try {
        setData(await getAdCampaignsBrowser());
      } catch {
        setError("Couldn't refresh campaigns.");
      }
    });
  }

  function withAction(fn: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        reload();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
      }
    });
  }

  if (!data) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Couldn&apos;t load campaigns. Refresh to try again.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-semibold">Ads / Campaigns</h1>
        {canManage && (
          <Link href="/admin/ads/new" className="rounded-md bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-black">
            New campaign
          </Link>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {isPending && <p className="text-sm text-zinc-400">Working…</p>}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2">Campaign</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Schedule</th>
              <th className="px-3 py-2">Impressions</th>
              <th className="px-3 py-2">Clicks</th>
              <th className="px-3 py-2">CTR</th>
              {canManage && <th className="px-3 py-2">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {data.campaigns.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2">
                  <Link href={`/admin/ads/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">{c.advertiser_name} · {c.creative_count} creative{c.creative_count === 1 ? "" : "s"}</p>
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLE[c.effective_state] ?? STATE_STYLE.draft}`}>{c.effective_state}</span>
                </td>
                <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                  {new Date(c.starts_at).toLocaleDateString()} → {new Date(c.ends_at).toLocaleDateString()}
                </td>
                <td className="px-3 py-2">{c.impressions}</td>
                <td className="px-3 py-2">{c.clicks}</td>
                <td className="px-3 py-2">{c.ctr}%</td>
                {canManage && (
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {c.status !== "active" && c.status !== "archived" && (
                        <button onClick={() => withAction(() => setCampaignStatusBrowser(c.id, "active" as CampaignStatus))} className="rounded border border-zinc-200 px-2 py-0.5 text-xs dark:border-zinc-800">Activate</button>
                      )}
                      {c.status === "active" && (
                        <button onClick={() => withAction(() => setCampaignStatusBrowser(c.id, "paused" as CampaignStatus))} className="rounded border border-zinc-200 px-2 py-0.5 text-xs dark:border-zinc-800">Pause</button>
                      )}
                      {c.status === "paused" && (
                        <button onClick={() => withAction(() => setCampaignStatusBrowser(c.id, "active" as CampaignStatus))} className="rounded border border-zinc-200 px-2 py-0.5 text-xs dark:border-zinc-800">Resume</button>
                      )}
                      {(c.status === "active" || c.status === "paused") && (
                        <button onClick={() => withAction(() => setCampaignStatusBrowser(c.id, "completed" as CampaignStatus))} className="rounded border border-zinc-200 px-2 py-0.5 text-xs dark:border-zinc-800">End</button>
                      )}
                      {c.status !== "archived" && (
                        <button onClick={() => withAction(() => setCampaignStatusBrowser(c.id, "archived" as CampaignStatus))} className="rounded border border-zinc-200 px-2 py-0.5 text-xs dark:border-zinc-800">Archive</button>
                      )}
                      <button onClick={() => withAction(() => duplicateCampaignBrowser(c.id))} className="rounded border border-zinc-200 px-2 py-0.5 text-xs dark:border-zinc-800">Duplicate</button>
                      {!c.has_events && (
                        <button onClick={() => confirm(`Delete "${c.name}" permanently?`) && withAction(() => deleteCampaignBrowser(c.id))} className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-700 dark:border-red-800 dark:text-red-400">Delete</button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {data.campaigns.length === 0 && (
              <tr>
                <td colSpan={canManage ? 7 : 6} className="px-3 py-6 text-center text-zinc-400">No campaigns yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
