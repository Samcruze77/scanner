"use client";

// The central reporting page for Admin Analytics and Geography. It is fed
// either by hand or from a URL (Geography's "Export this view", Analytics'
// "Export"), shows a preview of exactly what a report contains, and then
// downloads the COMPLETE filtered dataset. Preview and files come from the
// same backend walk (/api/admin/analytics-export), so the numbers shown here
// are the numbers in the file. No mock data, no client-side subset.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildExportUrl } from "@/utils/admin/exportClient";
import { getAdminAnalyticsBrowser } from "@/utils/admin/client.browser";
import { EMPTY_SELECTION, countryLabel, type LevelNodes, type Selection } from "@/utils/admin/geoLevels";
import { regionName } from "@/utils/admin/location";
import type { AnalyticsFilters } from "../../../supabase/functions/_shared/analyticsFilters";
import type { DateRange, DownloadExportFormat, ExportOptions, ExportRequest, ReportPreview, ReportSource } from "@/utils/admin/types";
import { CLARITY_DIMENSIONS, MAX_CLARITY_DIMENSIONS } from "@/utils/clarity/api";
import { GeoSelectors, selectClass } from "@/components/admin/GeoSelectors";
import { canManageExports, useAdminRole } from "../AdminRoleContext";

const REPORT_TYPES = [
  { value: "geography", label: "Geography Analytics" },
  { value: "full", label: "Full report (all events + ads)" },
  { value: "visitors", label: "Visitors (page views & opens)" },
  { value: "sessions", label: "Sessions (all events)" },
  { value: "scans", label: "Scans" },
  { value: "conversions", label: "Conversions" },
  { value: "downloads", label: "Downloads" },
  { value: "advertising", label: "Advertising" },
];

const DEVICES = ["desktop", "mobile", "tablet"];

const SOURCES: { value: ReportSource; label: string; hint: string }[] = [
  { value: "internal", label: "FreePDFScanner Analytics", hint: "Our own analytics database: visitors, sessions, page views, ads, geography down to neighborhood." },
  { value: "clarity", label: "Microsoft Clarity", hint: "Clarity's behavioural analytics for the last 1-3 days, country level (its API has no state or city)." },
  { value: "combined", label: "Combined", hint: "FreePDFScanner geography report plus Clarity rows in one file; every row says which source it came from." },
];
const FORMATS: { format: DownloadExportFormat; label: string }[] = [
  { format: "csv", label: "Download CSV" },
  { format: "xlsx", label: "Download XLSX" },
  { format: "json", label: "Download JSON" },
];

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

type Preview =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; key: string; request: ExportRequest; data: ReportPreview };

const inputClass = `${selectClass} w-full`;

export function ExportsClient({
  initialRange,
  initialReportType,
  initialFilters,
  autorun,
}: {
  initialRange: DateRange;
  initialReportType: string;
  initialFilters: AnalyticsFilters;
  autorun: boolean;
}) {
  const role = useAdminRole();
  const allowed = canManageExports(role);

  const [range, setRange] = useState(initialRange);
  const [reportType, setReportType] = useState(initialReportType);
  const [selection, setSelection] = useState<Selection>({
    ...EMPTY_SELECTION,
    country: initialFilters.country,
    state_province: initialFilters.state_province,
    city_town: initialFilters.city_town,
    county_district_lga: initialFilters.county_district_lga,
    neighborhood_suburb: initialFilters.neighborhood_suburb,
  });
  const [device, setDevice] = useState(initialFilters.device ?? "");
  const [visitorType, setVisitorType] = useState(initialFilters.visitor_type ?? "");
  const [campaignId, setCampaignId] = useState(initialFilters.campaign_id ?? "");
  const [creativeId, setCreativeId] = useState(initialFilters.creative_id ?? "");
  const [slotCode, setSlotCode] = useState(initialFilters.slot_code ?? "");

  const [source, setSource] = useState<ReportSource>("internal");
  const [clarityDays, setClarityDays] = useState<1 | 2 | 3>(3);
  const [clarityDims, setClarityDims] = useState<string[]>(["Country/Region"]);

  const [levelNodes, setLevelNodes] = useState<LevelNodes | null>(null);
  const [options, setOptions] = useState<ExportOptions | null>(null);
  const [preview, setPreview] = useState<Preview>({ status: "idle" });

  // Geography options come from the real analytics data for the chosen range.
  useEffect(() => {
    let cancelled = false;
    getAdminAnalyticsBrowser(range.from, range.to)
      .then((res) => {
        if (cancelled) return;
        setLevelNodes({
          country: res.geo?.countries ?? [],
          state_province: res.geo?.levels?.state_province ?? [],
          city_town: res.geo?.levels?.city_town ?? [],
          county_district_lga: res.geo?.levels?.county_district_lga ?? [],
          neighborhood_suburb: res.geo?.levels?.neighborhood_suburb ?? [],
        });
      })
      .catch(() => !cancelled && setLevelNodes(null));
    return () => {
      cancelled = true;
    };
  }, [range.from, range.to]);

  useEffect(() => {
    fetch("/api/admin/analytics-export?format=options")
      .then((r) => (r.ok ? r.json() : null))
      .then((o) => setOptions(o))
      .catch(() => setOptions(null));
  }, []);

  const request: ExportRequest = useMemo(
    () => ({
      reportType: source === "internal" ? reportType : source === "combined" ? "geography" : "full",
      source,
      clarity: { days: clarityDays, dimensions: clarityDims },
      dateRange: range,
      filters: {
        country: selection.country,
        state_province: selection.state_province,
        city_town: selection.city_town,
        county_district_lga: selection.county_district_lga,
        neighborhood_suburb: selection.neighborhood_suburb,
        device: device || null,
        visitor_type: visitorType || null,
        campaign_id: campaignId || null,
        creative_id: creativeId || null,
        slot_code: slotCode || null,
      },
    }),
    [source, clarityDays, clarityDims, reportType, range, selection, device, visitorType, campaignId, creativeId, slotCode],
  );
  const currentKey = buildExportUrl(request, "summary");

  const generate = useCallback(async (req: ExportRequest) => {
    setPreview({ status: "loading" });
    const key = buildExportUrl(req, "summary");
    try {
      const res = await fetch(key);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPreview({ status: "error", message: body?.error ?? `Report failed (${res.status})` });
        return;
      }
      setPreview({ status: "ready", key, request: req, data: body as ReportPreview });
    } catch {
      setPreview({ status: "error", message: "Couldn't reach the report service." });
    }
  }, []);

  // Arriving from "Export this view"/"Export" with a selection: preview it right away.
  const autoran = useRef(false);
  useEffect(() => {
    if (autorun && allowed && !autoran.current) {
      autoran.current = true;
      generate(request);
    }
  }, [autorun, allowed, generate, request]);

  if (!allowed) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Your role ({role ?? "unknown"}) doesn&apos;t have export access.
      </p>
    );
  }

  const campaigns = options?.campaigns ?? [];
  const creatives = (options?.creatives ?? []).filter((c) => !campaignId || c.campaign_id === campaignId);
  const adFilter = !!(campaignId || creativeId || slotCode);
  const stale = preview.status === "ready" && preview.key !== currentKey;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Exports</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Configure a report, preview exactly what it contains, then download the complete filtered dataset as CSV, XLSX or
          JSON. Files include your admin profile fields and the full Country → State / Province → City / Town → County /
          District / LGA → Neighborhood / Suburb hierarchy. Empty values stay empty.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-4 rounded-lg border border-zinc-200 bg-surface p-4 dark:border-zinc-800">
          <fieldset>
            <legend className="mb-1 text-sm text-zinc-500 dark:text-zinc-400">Report source</legend>
            <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Report source">
              {SOURCES.map((sc) => (
                <label
                  key={sc.value}
                  className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${source === sc.value ? "border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900" : "border-zinc-200 dark:border-zinc-800"}`}
                >
                  <input type="radio" name="report-source" value={sc.value} checked={source === sc.value} onChange={() => setSource(sc.value)} className="sr-only" />
                  <span className="block font-medium">{sc.label}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{SOURCES.find((x) => x.value === source)?.hint}</p>
          </fieldset>

          {source === "internal" && (
          <label className="block text-sm">
              <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Report</span>
              <select value={reportType} onChange={(e) => setReportType(e.target.value)} className={inputClass}>
                {REPORT_TYPES.map((rt) => (
                  <option key={rt.value} value={rt.value}>
                    {rt.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {source !== "clarity" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-zinc-500 dark:text-zinc-400">From</span>
              <input type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className={inputClass} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-zinc-500 dark:text-zinc-400">To</span>
              <input type="date" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className={inputClass} />
            </label>
          </div>
          )}

          {source !== "clarity" && (
            <>
          <fieldset className="space-y-2">
            <legend className="text-sm text-zinc-500 dark:text-zinc-400">Geography</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <GeoSelectors
                nodes={levelNodes ?? { country: [], state_province: [], city_town: [], county_district_lga: [], neighborhood_suburb: [] }}
                selection={selection}
                onChange={setSelection}
                className="w-full"
              />
            </div>
            {!levelNodes && <p className="text-xs text-zinc-400">Loading locations from your analytics data…</p>}
          </fieldset>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Device</span>
              <select value={device} onChange={(e) => setDevice(e.target.value)} className={inputClass}>
                <option value="">All devices</option>
                {DEVICES.map((d) => (
                  <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Visitors</span>
              <select value={visitorType} onChange={(e) => setVisitorType(e.target.value)} className={inputClass}>
                <option value="">New + returning</option>
                <option value="new">New only</option>
                <option value="returning">Returning only</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Campaign</span>
              <select
                value={campaignId}
                onChange={(e) => {
                  setCampaignId(e.target.value);
                  setCreativeId("");
                }}
                className={inputClass}
              >
                <option value="">All campaigns</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Creative</span>
              <select value={creativeId} onChange={(e) => setCreativeId(e.target.value)} className={inputClass}>
                <option value="">All creatives</option>
                {creatives.map((c) => (
                  <option key={c.id} value={c.id}>{c.title || `${c.slot_code} (${c.id.slice(0, 8)})`}</option>
                ))}
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Ad slot</span>
              <select value={slotCode} onChange={(e) => setSlotCode(e.target.value)} className={inputClass}>
                <option value="">All slots</option>
                {(options?.slots ?? []).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          {adFilter && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Campaign, creative and slot filters apply to ad events only, so analytics events are left out of this report.
            </p>
          )}
            </>
          )}

          {source !== "internal" && (
            <fieldset className="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <legend className="px-1 text-sm text-zinc-500 dark:text-zinc-400">Microsoft Clarity</legend>
              {options && options.clarity_configured === false && (
                <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  Clarity isn&apos;t connected on the server. Set <code>CLARITY_API_TOKEN</code> (Clarity project, Settings, Data Export)
                  in the hosting environment and redeploy.
                </p>
              )}
              <label className="block text-sm">
                <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Window</span>
                <select value={clarityDays} onChange={(e) => setClarityDays(Number(e.target.value) as 1 | 2 | 3)} className={inputClass}>
                  <option value={1}>Last 24 hours</option>
                  <option value={2}>Last 48 hours</option>
                  <option value={3}>Last 72 hours</option>
                </select>
              </label>
              <div>
                <p className="mb-1 text-sm text-zinc-500 dark:text-zinc-400">Break down by (up to {MAX_CLARITY_DIMENSIONS})</p>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {CLARITY_DIMENSIONS.map((d) => {
                    const on = clarityDims.includes(d.value);
                    return (
                      <label key={d.value} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={!on && clarityDims.length >= MAX_CLARITY_DIMENSIONS}
                          onChange={() => setClarityDims((prev) => (on ? prev.filter((x) => x !== d.value) : [...prev, d.value]))}
                        />
                        {d.label}
                      </label>
                    );
                  })}
                </div>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Clarity&apos;s export only covers the last 72 hours, allows 10 requests per day, and has no state, city, county or
                neighborhood breakdown. Those levels come from FreePDFScanner&apos;s own analytics.
              </p>
            </fieldset>
          )}

          <button
            type="button"
            onClick={() => generate(request)}
            disabled={preview.status === "loading" || (source !== "internal" && clarityDims.length === 0)}
            className="w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-black sm:w-auto"
          >
            {preview.status === "loading" ? "Generating…" : "Generate report"}
          </button>
        </div>

        <ReportPreviewCard preview={preview} stale={stale} options={options} />
      </div>
    </div>
  );
}

function ReportPreviewCard({
  preview,
  stale,
  options,
}: {
  preview: Preview;
  stale: boolean;
  options: ExportOptions | null;
}) {
  if (preview.status === "idle") {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        Choose a report and filters, then press Generate report to see what it will contain.
      </div>
    );
  }
  if (preview.status === "loading") return <div className="rounded-lg border border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">Reading your analytics data…</div>;
  if (preview.status === "error") return <div role="alert" className="rounded-lg border border-red-200 p-4 text-sm text-red-600 dark:border-red-900">{preview.message}</div>;

  const { data, request } = preview;
  const f = data.filters;
  const src: ReportSource = data.source ?? "internal";
  const isClarity = src === "clarity";
  const lines: [string, string][] = [
    ["Source", SOURCES.find((x) => x.value === src)?.label ?? src],
    ["Report", src === "clarity" ? "Microsoft Clarity" : src === "combined" ? "Combined (geography + Clarity)" : (REPORT_TYPES.find((r) => r.value === data.report_type)?.label ?? data.report_type)],
    [isClarity ? "Window" : "Date range", `${fmtDate(data.range.from)} – ${fmtDate(data.range.to)}`],
  ];
  if (data.clarity) {
    lines.push(["Clarity window", `${fmtDate(data.clarity.window.from)} – ${fmtDate(data.clarity.window.to)}`]);
    lines.push(["Clarity breakdown", data.clarity.dimensions.join(", ")]);
  }
  if (!isClarity && f.country) lines.push(["Country", countryLabel(f.country)]);
  if (!isClarity && f.state_province) lines.push(["State / Province", regionName(f.country, f.state_province) ?? f.state_province]);
  if (!isClarity && f.city_town) lines.push(["City / Town", f.city_town]);
  if (!isClarity && f.county_district_lga) lines.push(["County / District / LGA", f.county_district_lga]);
  if (!isClarity && f.neighborhood_suburb) lines.push(["Neighborhood / Suburb", f.neighborhood_suburb]);
  if (!isClarity && f.visitor_type) lines.push(["Visitors", f.visitor_type === "new" ? "New only" : "Returning only"]);
  if (!isClarity && f.device) lines.push(["Device", f.device]);
  if (!isClarity && f.campaign_id) lines.push(["Campaign", options?.campaigns.find((c) => c.id === f.campaign_id)?.name ?? f.campaign_id]);
  if (!isClarity && f.creative_id) lines.push(["Creative", options?.creatives.find((c) => c.id === f.creative_id)?.title ?? f.creative_id]);
  if (!isClarity && f.slot_code) lines.push(["Ad slot", f.slot_code]);

  const s = data.summary;
  const metrics: [string, number | null][] = isClarity
    ? [
        ["Clarity rows", data.clarity?.rows ?? 0],
        ["Sessions (Clarity)", s.sessions],
        ["Clarity metrics", data.clarity?.metrics.length ?? 0],
      ]
    : [
    ["Records", s.records],
    ["Report rows", data.report_rows],
    ["Visitors", s.visitors],
    ["Sessions", s.sessions],
    ["Page views", s.page_views],
    ["Conversions", s.conversions],
    ["Ad impressions", s.ad_impressions],
    ["Ad clicks", s.ad_clicks],
        ...(data.clarity ? ([["Clarity rows", data.clarity.rows]] as [string, number | null][]) : []),
      ];

  return (
    <div className="min-w-0 space-y-4 rounded-lg border border-zinc-200 bg-surface p-4 dark:border-zinc-800">
      <p className="text-sm font-medium">Report preview</p>
      {stale && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Filters changed since this preview. Generate the report again before downloading.
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {lines.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-zinc-500 dark:text-zinc-400">{k}</dt>
            <dd className="min-w-0 break-words font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {data.clarity_error && (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Microsoft Clarity: {data.clarity_error.message}
        </p>
      )}
      {isClarity && !data.clarity ? null : s.records === 0 && !data.clarity?.rows ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No records match these filters.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {metrics
            .filter(([, v]) => v !== null)
            .map(([k, v]) => (
              <div key={k} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <dt className="text-xs text-zinc-500 dark:text-zinc-400">{k}</dt>
                <dd className="text-lg font-semibold tabular-nums">{fmt(v as number)}</dd>
              </div>
            ))}
        </dl>
      )}
      <div className="flex flex-wrap gap-2">
        {FORMATS.map(({ format, label }) =>
          stale || (s.records === 0 && !data.clarity?.rows) || (src !== "internal" && !data.clarity) ? (
            <span key={format} aria-disabled="true" className="cursor-not-allowed rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium opacity-50 dark:border-zinc-800">
              {label}
            </span>
          ) : (
            <a
              key={format}
              href={buildExportUrl(request, format)}
              download
              className={`rounded-md px-4 py-2 text-sm font-medium ${format === "csv" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black" : "border border-zinc-200 dark:border-zinc-800"}`}
            >
              {label}
            </a>
          ),
        )}
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Files contain every matching record, not just the totals above. Each export is recorded in the audit log.
      </p>
    </div>
  );
}
