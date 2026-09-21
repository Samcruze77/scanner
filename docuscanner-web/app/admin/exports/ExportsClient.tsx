"use client";

import { useState } from "react";
import { exportClient, ExportNotConnectedError } from "@/utils/admin/exportClient";
import { defaultDateRange } from "@/utils/admin/dateRange";
import type { ExportFormat } from "@/utils/admin/types";
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
  const [device, setDevice] = useState("");
  const [country, setCountry] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [pendingNotice, setPendingNotice] = useState<ExportFormat | null>(null);

  async function submit(format: ExportFormat) {
    const filters: Record<string, string> = {};
    if (device) filters.device = device;
    if (country) filters.country = country;

    try {
      await exportClient.createExportJob({
        reportType,
        format,
        dateRange: range,
        filters: Object.keys(filters).length ? filters : undefined,
        emailTo: format === "email" ? emailTo.trim() : undefined,
      });
    } catch (err) {
      if (err instanceof ExportNotConnectedError) {
        setPendingNotice(format);
        return;
      }
      throw err;
    }
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
          This is the UI foundation for exports. No export Edge Function is deployed yet, so
          nothing below actually generates a file or sends an email -- it&apos;s wired up and
          ready to connect once that backend exists.
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
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Country (optional)</span>
            <input
              type="text"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="e.g. US"
              className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black"
            />
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
            {pendingNotice === "email" ? "Emailing" : `Downloading as ${pendingNotice.toUpperCase()}`}{" "}
            isn&apos;t available yet -- the backend export function hasn&apos;t been deployed.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => submit("csv")}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-black"
          >
            Download CSV
          </button>
          <button
            type="button"
            onClick={() => submit("pdf")}
            className="rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium dark:border-zinc-800"
          >
            Download PDF
          </button>
          <button
            type="button"
            onClick={() => submit("email")}
            className="rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium dark:border-zinc-800"
          >
            Email report
          </button>
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">Recent exports</p>
        <p className="text-sm text-zinc-400">
          Export history will appear here once the backend integration is live.
        </p>
      </div>
    </div>
  );
}
