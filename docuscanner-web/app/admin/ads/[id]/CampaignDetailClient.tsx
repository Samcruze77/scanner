"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AdCampaignDetailResponse, AdCreative } from "@/utils/admin/ads";
import { TARGETABLE_PATHS } from "@/utils/admin/targetablePaths";
import { countryFlag, countryName } from "@/utils/admin/location";
import { canManageAds, useAdminRole } from "../../AdminRoleContext";
import { CampaignForm } from "../CampaignForm";

const EMBED_HOST_ALLOWLIST = new Set([
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
  "player.vimeo.com",
]);

function safeEmbedUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !EMBED_HOST_ALLOWLIST.has(parsed.hostname.toLowerCase())) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function Table({ title, rows }: { title: string; rows: { key: string; count: number }[] }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="mb-1 text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400">No data</p>
      ) : (
        <ul className="space-y-0.5 text-sm">
          {rows.slice(0, 8).map((r) => (
            <li key={r.key} className="flex justify-between">
              <span>{r.key}</span>
              <span className="text-zinc-500">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CampaignDetailClient({ initial }: { initial: AdCampaignDetailResponse }) {
  const role = useAdminRole();
  const canManage = canManageAds(role);
  const [editing, setEditing] = useState(false);
  const [previewSlot, setPreviewSlot] = useState(initial.creatives[0]?.slot_code ?? "bottom");
  const [previewWidth, setPreviewWidth] = useState<"desktop" | "mobile">("desktop");

  const { campaign, creatives, analytics } = initial;
  const previewCreative =
    creatives.find((c) => c.slot_code === previewSlot && (c.device_variant === previewWidth || c.device_variant === "all")) ??
    creatives.find((c) => c.slot_code === previewSlot);
  const previewEmbedUrl = previewCreative ? safeEmbedUrl(previewCreative.destination_type === "embed" ? previewCreative.embed_url : null) : null;

  const targetingSummary = useMemo(() => {
    const parts: string[] = [];
    if (campaign.target_countries.length === 0) {
      parts.push("Worldwide");
    } else {
      const countryLabel = campaign.target_countries.map((code) => `${countryFlag(code) ?? ""} ${countryName(code) ?? code}`.trim()).join(", ");
      parts.push(campaign.target_regions.length > 0 ? `${countryLabel} → ${campaign.target_regions.join(", ")}` : countryLabel);
    }
    parts.push(campaign.target_devices.length > 0 ? campaign.target_devices.join(" + ") : "All devices");
    parts.push(
      campaign.target_paths.length > 0
        ? campaign.target_paths.map((p) => TARGETABLE_PATHS.find((t) => t.path === p)?.label ?? p).join(" + ")
        : "Entire site",
    );
    parts.push(`${new Date(campaign.starts_at).toLocaleDateString()}–${new Date(campaign.ends_at).toLocaleDateString()}`);
    return parts.join(" · ");
  }, [campaign]);

  if (editing) {
    return (
      <div className="space-y-4">
        <button onClick={() => setEditing(false)} className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">← Back to campaign</button>
        <CampaignForm existing={campaign} creatives={creatives} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/admin/ads" className="text-sm text-zinc-500 hover:underline dark:text-zinc-400">← Campaigns</Link>
        <div className="mt-1 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">{campaign.name}</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{campaign.advertiser_name} · {campaign.effective_state}</p>
          </div>
          {canManage && (
            <button onClick={() => setEditing(true)} className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm font-medium dark:border-zinc-800">
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
        <span className="font-medium">Targeting: </span>
        {targetingSummary}
      </div>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Impressions</p>
          <p className="text-xl font-semibold">{analytics.impressions}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Clicks</p>
          <p className="text-xl font-semibold">{analytics.clicks}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">CTR</p>
          <p className="text-xl font-semibold">{analytics.ctr}%</p>
        </div>
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Active dates</p>
          <p className="text-sm">{new Date(campaign.starts_at).toLocaleDateString()} → {new Date(campaign.ends_at).toLocaleDateString()}</p>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Table title="By slot" rows={analytics.by_slot} />
        <Table title="By device" rows={analytics.by_device} />
        <Table title="By country" rows={analytics.by_country} />
        <Table title="By region" rows={analytics.by_region} />
        <Table title="By page" rows={analytics.by_path} />
      </section>

      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="mb-3 text-sm font-semibold">Preview</h2>
        <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
          Approximate only -- actual placement depends on the page layout, not just this box.
        </p>
        <div className="mb-3 flex flex-wrap gap-2">
          <select value={previewSlot} onChange={(e) => setPreviewSlot(e.target.value as AdCreative["slot_code"])} className="rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-black">
            {[...new Set(creatives.map((c) => c.slot_code))].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <div className="flex overflow-hidden rounded-md border border-zinc-200 text-sm dark:border-zinc-800">
            <button onClick={() => setPreviewWidth("desktop")} className={`px-3 py-1 ${previewWidth === "desktop" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black" : ""}`}>Desktop</button>
            <button onClick={() => setPreviewWidth("mobile")} className={`px-3 py-1 ${previewWidth === "mobile" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black" : ""}`}>Mobile</button>
          </div>
        </div>
        {previewCreative && (
          <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
            Media: {previewCreative.media_type === "video" && previewCreative.destination_type !== "embed" ? "Self-hosted video" : "Image"}
            {" · "}
            Destination: {previewCreative.destination_type === "embed" ? (previewEmbedUrl ? "Supported embed" : "Embed (invalid host, falling back to link)") : "Website / social link"}
            {" → "}
            <span className="font-mono">{previewCreative.destination_type === "embed" ? previewCreative.embed_url : previewCreative.click_url}</span>
          </p>
        )}
        {previewCreative && previewEmbedUrl ? (
          <div className={`overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 ${previewWidth === "mobile" ? "max-w-[375px]" : "max-w-[728px]"}`}>
            <iframe
              src={previewEmbedUrl}
              title={previewCreative.title ?? "Embed preview"}
              className="aspect-video w-full"
              sandbox="allow-scripts allow-same-origin allow-presentation"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="encrypted-media; picture-in-picture"
            />
          </div>
        ) : previewCreative && previewCreative.media_type === "video" ? (
          <div className={`overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 ${previewWidth === "mobile" ? "max-w-[375px]" : "max-w-[728px]"}`}>
            <video src={previewCreative.asset_url} controls className="w-full" />
            {(previewCreative.title || previewCreative.cta_text) && (
              <div className="flex items-center justify-between p-2 text-sm">
                <span>{previewCreative.title}</span>
                {previewCreative.cta_text && <span className="font-medium">{previewCreative.cta_text}</span>}
              </div>
            )}
          </div>
        ) : previewCreative ? (
          <a href={previewCreative.click_url} target="_blank" rel="noreferrer" className={`block overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 ${previewWidth === "mobile" ? "max-w-[375px]" : "max-w-[728px]"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- advertiser-hosted image, arbitrary remote host */}
            <img src={previewCreative.asset_url} alt={previewCreative.alt_text ?? ""} className="w-full" />
            {(previewCreative.title || previewCreative.cta_text) && (
              <div className="flex items-center justify-between p-2 text-sm">
                <span>{previewCreative.title}</span>
                {previewCreative.cta_text && <span className="font-medium">{previewCreative.cta_text}</span>}
              </div>
            )}
          </a>
        ) : (
          <p className="text-sm text-zinc-400">No creative for this slot/device combination.</p>
        )}
      </section>
    </div>
  );
}
