"use client";

import { useState } from "react";
import { buildExportUrl } from "@/utils/admin/exportClient";
import { defaultDateRange } from "@/utils/admin/dateRange";
import type { DownloadExportFormat } from "@/utils/admin/types";
import { canManageExports, useAdminRole } from "../AdminRoleContext";

const REPORT_TYPES = [
  { value: "visitors", label: "Visitors" },
  { value: "sessions", label: "Sessions" },
  { value: "scans", label: "Scans" },
  { value: "conversions", label: "Conversions" },
  { value: "downloads", label: "Downloads" },
  { value: "advertising", label: "Advertising" },
  { value: "full", label: "Full report" },
];

export function ExportsClient() {
  const role = useAdminRole();
  const allowed = canManageExports(role);

  const [range, setRange] = useState(defaultDateRange(30));
  const [reportType, setReportType] = useState(REPORT_TYPES[0].value);
  const [geo, setGeo] = useState({
    country: "",
    state_province: "",
    city_town: "",
    county_district_lga: "",
    neighborhood_suburb: "",
  });
  const [device, setDevice] = useState("");
  const [visitorType, setVisitorType] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [pendingNotice, setPendingNotice] = useState<"pdf" | "email" | null>(null);

  // The whole selection lives in the URL, so the download is an ordinary
  // authenticated GET -- nothing depends on client state surviving it.
  function downloadUrl(format: DownloadExportFormat) {
    const filters: Record<string, string> = {};
    for (const [key, value] of Object.entries(geo)) if (value.trim()) filters[key] = value.trim();
    if (device.trim()) filters.device = device.trim();
    if (visitorType) filters.visitor_type = visitorType;
    return buildExportUrl({ reportType, format, dateRange: range, filters });
  }

  if (!allowed) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Your role ({role ?? "unknown"}) doesn&apos;t have export access.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold">Exports</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Downloads every record in the selected range and filters (not just what a page shows), including your
          admin profile fields and the full Country → State / Province → City / Town → County / District / LGA →
          Neighborhood / Suburb hierarchy. Empty values stay empty.
        </p>
      </div>

      <div className="max-w-xl space-y-4 rounded-lg border border-zinc-200 bg-surface p-4 dark:border-zinc-800">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">From</span>
            <input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">To</span>
            <input
              type="date"
              value={range.to}
              min={range.from}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black"
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Report type</span>
          <select
            value={reportType}
            onChange={(e) => setReportType(e.target.value)}
            className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black"
          >
            {REPORT_TYPES.map((rt) => (
              <option key={rt.value} value={rt.value}>
                {rt.label}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Country (optional)</span>
            <input
              type="text"
              value={geo.country}
              onChange={(e) => setGeo((g) => ({ ...g, country: e.target.value }))}
              placeholder="ISO code, e.g. US"
              className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">State / Province (optional)</span>
            <input
              type="text"
              value={geo.state_province}
              onChange={(e) => setGeo((g) => ({ ...g, state_province: e.target.value }))}
              placeholder="as stored"
              className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">City / Town (optional)</span>
            <input
              type="text"
              value={geo.city_town}
              onChange={(e) => setGeo((g) => ({ ...g, city_town: e.target.value }))}
              placeholder="as stored"
              className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">County / District / LGA (optional)</span>
            <input
              type="text"
              value={geo.county_district_lga}
              onChange={(e) => setGeo((g) => ({ ...g, county_district_lga: e.target.value }))}
              placeholder="as stored"
              className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Neighborhood / Suburb (optional)</span>
            <input
              type="text"
              value={geo.neighborhood_suburb}
              onChange={(e) => setGeo((g) => ({ ...g, neighborhood_suburb: e.target.value }))}
              placeholder="as stored"
              className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Device (optional)</span>
            <input
              type="text"
              value={device}
              onChange={(e) => setDevice(e.target.value)}
              placeholder="e.g. mobile"
              className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Visitors (optional)</span>
            <select
              value={visitorType}
              onChange={(e) => setVisitorType(e.target.value)}
              className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black"
            >
              <option value="">New + returning</option>
              <option value="new">New only</option>
              <option value="returning">Returning only</option>
            </select>
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Email destination (for email report)</span>
          <input
            type="email"
            value={emailTo}
            onChange={(e) => setEmailTo(e.target.value)}
            placeholder="name@company.com"
            className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black"
          />
        </label>

        {pendingNotice && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            {pendingNotice === "email" ? "Emailing" : "Downloading as PDF"} isn&apos;t available -- use CSV, Excel or JSON.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <a
            href={downloadUrl("csv")}
            download
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-black"
          >
            Download CSV
          </a>
          <a
            href={downloadUrl("xlsx")}
            download
            className="rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium dark:border-zinc-800"
          >
            Download Excel
          </a>
          <a
            href={downloadUrl("json")}
            download
            className="rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium dark:border-zinc-800"
          >
            Download JSON
          </a>
          <button
            type="button"
            onClick={() => setPendingNotice("pdf")}
            className="rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium dark:border-zinc-800"
          >
            Download PDF
          </button>
          <button
            type="button"
            onClick={() => setPendingNotice("email")}
            className="rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium dark:border-zinc-800"
          >
            Email report
          </button>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">Recent exports</p>
        <p className="text-sm text-zinc-400">
          Each export is recorded in the audit log.
        </p>
      </div>
    </div>
  );
}
