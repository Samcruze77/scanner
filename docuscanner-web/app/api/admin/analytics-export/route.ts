// The ONE backend behind every admin analytics report/download: the Export
// page, Geography's "Export this view" and Analytics' "Export" all end up
// here (via /admin/exports), with the whole selection in the query string.
//
//   format=summary  -> JSON preview (record counts + metrics) of the report
//   format=options  -> JSON option lists (campaigns/creatives/slots)
//   format=csv|xlsx|json -> the complete filtered dataset as a file
//
// A plain GET authenticated by the admin's session cookie, so the browser
// downloads natively and nothing depends on client-side state. All data and
// the authorization decision come from the `admin-analytics-export` Edge
// Function (active admin_users row, role super_admin/admin), called with the
// caller's own access token -- this route holds no service credentials and
// reads no table itself. The Edge Function is paged by primary-key cursor;
// this route walks every page (summary and files use the identical walk), so
// size is bounded by the database, not by a UI page limit.

import { PassThrough, Readable } from "node:stream";
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getVerifiedClaims } from "@/utils/supabase/claims";
import {
  CSV_BOM,
  csvHeader,
  csvLine,
  exportColumns,
  exportFilename,
  flattenGeoRow,
  flattenRecord,
  jsonRecord,
  xlsxRow,
  type FlatRow,
} from "@/utils/admin/exportFile";
import { GeoReportBuilder, SummaryBuilder } from "@/utils/admin/geoReport";
import { walkExport } from "@/utils/admin/exportPaging";
import { parseClarityRequest, windowFor } from "@/utils/clarity/api";
import { ClarityError, clarityConfigured, getClarityInsights } from "@/utils/clarity/client.server";
import { clarityColumns, clarityFlatRows, combinedColumns, internalFlatRows, withProfile } from "@/utils/admin/clarityReport";
import { filtersToParams, hasAdFilters, parseFilters, resolveRange } from "../../../../supabase/functions/_shared/analyticsFilters";
import type { AdminProfileRecord } from "../../../../supabase/functions/_shared/adminProfile";
import {
  parseReportType,
  planFor,
  type ExportDataset,
  type ExportPage,
} from "../../../../supabase/functions/_shared/exportRows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const PAGE_SIZE = 1000;

const FILE_TYPES = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  json: "application/json; charset=utf-8",
} as const;
type FileFormat = keyof typeof FILE_TYPES;

class UpstreamError extends Error {
  constructor(public status: number) {
    super(`export source responded ${status}`);
  }
}

async function callEdge(token: string, params: URLSearchParams) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-analytics-export?${params}`, {
    headers: { Authorization: `Bearer ${token}`, apikey: PUBLISHABLE_KEY },
    cache: "no-store",
  });
  if (!res.ok) throw new UpstreamError(res.status);
  return res.json();
}

function fetchPage(token: string, base: URLSearchParams, dataset: ExportDataset, after: number, limit = PAGE_SIZE): Promise<ExportPage> {
  const params = new URLSearchParams(base);
  params.set("dataset", dataset);
  params.set("after", String(after));
  params.set("limit", String(limit));
  return callEdge(token, params);
}

function upstreamFailure(err: unknown) {
  const status = err instanceof UpstreamError && [400, 401, 403].includes(err.status) ? err.status : 502;
  const error = status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : status === 400 ? "Invalid export request" : "Export is unavailable";
  return NextResponse.json({ error }, { status });
}

function csvStream(columns: string[], rows: AsyncGenerator<FlatRow>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(CSV_BOM + csvHeader(columns)));
    },
    async pull(controller) {
      try {
        const { value, done } = await rows.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(csvLine(value, columns)));
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

function jsonStream(columns: string[], profile: AdminProfileRecord, rows: AsyncGenerator<FlatRow>, meta: Record<string, unknown>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let count = 0;
  return new ReadableStream({
    start(controller) {
      const head = JSON.stringify(meta).slice(0, -1);
      controller.enqueue(encoder.encode(`${head},"columns":${JSON.stringify(columns)},"records":[`));
    },
    async pull(controller) {
      try {
        const { value, done } = await rows.next();
        if (done) {
          controller.enqueue(encoder.encode(`],"record_count":${count}}`));
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode((count++ ? "," : "") + JSON.stringify(jsonRecord(value, columns, profile))));
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

function xlsxStream(columns: string[], rows: AsyncGenerator<FlatRow>, info: [string, string][]): ReadableStream<Uint8Array> {
  const out = new PassThrough();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: false, useSharedStrings: false });
  (async () => {
    const sheet = workbook.addWorksheet("Analytics export");
    sheet.addRow([...columns]).commit();
    for await (const row of rows) sheet.addRow(xlsxRow(row, columns)).commit();
    sheet.commit();
    const infoSheet = workbook.addWorksheet("Export info");
    for (const line of info) infoSheet.addRow(line).commit();
    infoSheet.commit();
    await workbook.commit();
  })().catch((err) => out.destroy(err));
  return Readable.toWeb(out) as unknown as ReadableStream<Uint8Array>;
}

const CLARITY_HTTP: Record<ClarityError["code"], number> = { not_configured: 503, unauthorized: 502, rate_limited: 429, unavailable: 502 };

function sumSessions(rows: { metrics: Record<string, string | number | null> }[]): number | null {
  let total = 0;
  let any = false;
  for (const r of rows) {
    const v = r.metrics["Traffic.totalSessionCount"];
    if (typeof v === "number") {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
}

// Microsoft Clarity and Combined reports. Same auth as everything else here:
// the admin-analytics-export Edge Function is called with the caller's token
// first (it enforces the admin role and supplies the admin profile), then the
// Clarity API is called server-side with CLARITY_API_TOKEN.
async function handleClarity(url: URL, source: "clarity" | "combined", format: string, token: string) {
  const clarityReq = parseClarityRequest(url.searchParams);
  if ("error" in clarityReq) return NextResponse.json({ error: clarityReq.error }, { status: 400 });

  const filters = parseFilters(url.searchParams);
  const range = resolveRange(url.searchParams);
  if (range.ok === false) return NextResponse.json({ error: range.error }, { status: 400 });
  const rangeFrom = range.from.toISOString().slice(0, 10);
  const rangeTo = range.to.toISOString().slice(0, 10);
  const base = filtersToParams(filters);
  base.set("from", rangeFrom);
  base.set("to", rangeTo);
  base.set("report_type", "geography");

  // Admin gate + profile (also records the export in the audit log).
  const plan = planFor("geography", hasAdFilters(filters));
  let first: ExportPage;
  try {
    first = await fetchPage(token, base, plan.datasets[0] ?? "ads", 0, source === "clarity" ? 1 : PAGE_SIZE);
  } catch (err) {
    return upstreamFailure(err);
  }
  const profile = first.profile;

  let clarity: Awaited<ReturnType<typeof getClarityInsights>> | null = null;
  let clarityError: { code: string; message: string; status: number } | null = null;
  try {
    clarity = await getClarityInsights(clarityReq);
  } catch (err) {
    if (err instanceof ClarityError) clarityError = { code: err.code, message: err.message, status: CLARITY_HTTP[err.code] };
    else clarityError = { code: "unavailable", message: "Clarity request failed.", status: 502 };
  }
  const win = { ...windowFor(clarityReq.numOfDays), days: clarityReq.numOfDays };

  if (format === "summary") {
    let internal: unknown = null;
    if (source === "combined") {
      const summary = new SummaryBuilder();
      const geo = new GeoReportBuilder();
      try {
        for await (const { record } of walkExport((d, a) => fetchPage(token, base, d, a), plan.datasets, first)) {
          summary.add(record);
          geo.add(record);
        }
      } catch (err) {
        return upstreamFailure(err);
      }
      internal = { summary: summary.result(plan.datasets), report_rows: geo.rows().length };
    }
    return NextResponse.json(
      {
        source,
        report_type: source === "clarity" ? "clarity" : "combined",
        range: source === "clarity" ? { from: win.from, to: win.to } : { from: rangeFrom, to: rangeTo },
        filters,
        datasets: source === "combined" ? plan.datasets : [],
        summary:
          (internal as { summary: unknown } | null)?.summary ?? {
            records: clarity?.rows.length ?? 0,
            event_records: 0,
            ad_records: 0,
            visitors: null,
            sessions: clarity ? sumSessions(clarity.rows) : null,
            page_views: null,
            conversions: null,
            ad_impressions: null,
            ad_clicks: null,
            first_record_at: null,
            last_record_at: null,
          },
        report_rows: (internal as { report_rows: number } | null)?.report_rows ?? null,
        clarity: clarity
          ? {
              configured: true,
              window: win,
              dimensions: clarityReq.dimensions,
              rows: clarity.rows.length,
              fetched_at: clarity.fetchedAt,
              metrics: [...new Set(clarity.rows.flatMap((r) => Object.keys(r.metrics)))].sort(),
              sessions: sumSessions(clarity.rows),
              users: null,
            }
          : null,
        clarity_error: clarityError ? { code: clarityError.code, message: clarityError.message } : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // Files need Clarity data: report the reason rather than a silent partial file.
  if (!clarity) {
    return NextResponse.json({ error: clarityError?.message ?? "Clarity data unavailable", code: clarityError?.code }, { status: clarityError?.status ?? 502 });
  }

  let flat: FlatRow[];
  let columns: string[];
  if (source === "clarity") {
    flat = withProfile(clarityFlatRows(clarity.rows, clarityReq), profile);
    columns = clarityColumns(profile, clarity.rows);
  } else {
    const builder = new GeoReportBuilder();
    try {
      for await (const { record } of walkExport((d, a) => fetchPage(token, base, d, a), plan.datasets, first)) builder.add(record);
    } catch (err) {
      return upstreamFailure(err);
    }
    flat = withProfile([...internalFlatRows(builder.rows()), ...clarityFlatRows(clarity.rows, clarityReq)], profile);
    columns = combinedColumns(profile, clarity.rows);
  }

  async function* rows(): AsyncGenerator<FlatRow> {
    for (const r of flat) yield r;
  }
  const fileFormat = format as FileFormat;
  const exportedAt = new Date().toISOString();
  const meta = {
    exported_at: exportedAt,
    source,
    range: { from: rangeFrom, to: rangeTo },
    clarity_window: win,
    clarity_dimensions: clarityReq.dimensions,
    clarity_fetched_at: clarity.fetchedAt,
    filters,
    admin_profile: profile,
  };
  const body =
    fileFormat === "csv"
      ? csvStream(columns, rows())
      : fileFormat === "json"
        ? jsonStream(columns, profile, rows(), meta)
        : xlsxStream(columns, rows(), [
            ["exported_at", exportedAt],
            ["source", source],
            ["clarity_window", `${win.from} to ${win.to}`],
            ["clarity_dimensions", clarityReq.dimensions.join(", ")],
            ["clarity_fetched_at", clarity.fetchedAt],
            ...Object.entries(profile).map(([k, v]) => [k, v == null ? "" : String(v)] as [string, string]),
          ]);
  return new Response(body, {
    headers: {
      "Content-Type": FILE_TYPES[fileFormat],
      "Content-Disposition": `attachment; filename="${exportFilename(fileFormat, source, source === "clarity" ? win.from : rangeFrom, source === "clarity" ? win.to : rangeTo)}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request) {
  const { claims } = await getVerifiedClaims();
  if (!claims) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "csv";
  if (format !== "summary" && format !== "options" && !(format in FILE_TYPES)) {
    return NextResponse.json({ error: "Unsupported format" }, { status: 400 });
  }

  // Only the verified caller's own token is ever forwarded; the Edge
  // Function re-verifies it and checks admin_users itself.
  const supabase = createClient(await cookies());
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token || !SUPABASE_URL) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (format === "options") {
    // Whether Clarity reporting is connected is reported alongside the option
    // lists (a boolean only -- never the token).
    try {
      const options = await callEdge(token, new URLSearchParams({ mode: "options" }));
      return NextResponse.json({ ...options, clarity_configured: clarityConfigured() }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return upstreamFailure(err);
    }
  }

  const source = url.searchParams.get("source") ?? "internal";
  if (source !== "internal" && source !== "clarity" && source !== "combined") {
    return NextResponse.json({ error: "Invalid source" }, { status: 400 });
  }
  if (source !== "internal") return handleClarity(url, source, format, token);

  const report = parseReportType(url.searchParams.get("report_type") ?? "full");
  if (!report) return NextResponse.json({ error: "Invalid report_type" }, { status: 400 });
  const range = resolveRange(url.searchParams);
  if (range.ok === false) return NextResponse.json({ error: range.error }, { status: 400 });

  // The selection is parsed once (aliases resolved, ids validated) and only
  // its canonical form is forwarded -- nothing else from the request is.
  const filters = parseFilters(url.searchParams);
  const plan = planFor(report, hasAdFilters(filters));
  if (plan.datasets.length === 0) {
    return NextResponse.json(
      { error: "Campaign, creative and slot filters only apply to ad events. Choose the Advertising, Geography or Full report." },
      { status: 400 },
    );
  }
  const rangeFrom = range.from.toISOString().slice(0, 10);
  const rangeTo = range.to.toISOString().slice(0, 10);
  const base = filtersToParams(filters);
  base.set("from", rangeFrom);
  base.set("to", rangeTo);
  base.set("report_type", report);

  let first: ExportPage;
  try {
    first = await fetchPage(token, base, plan.datasets[0], 0);
  } catch (err) {
    return upstreamFailure(err);
  }
  const profile = first.profile;
  const walk = () => walkExport((dataset, after) => fetchPage(token, base, dataset, after), plan.datasets, first);

  if (format === "summary") {
    try {
      const summary = new SummaryBuilder();
      const geo = new GeoReportBuilder();
      for await (const { record } of walk()) {
        summary.add(record);
        if (report === "geography") geo.add(record);
      }
      return NextResponse.json(
        {
          report_type: report,
          range: { from: rangeFrom, to: rangeTo },
          filters,
          datasets: plan.datasets,
          summary: summary.result(plan.datasets),
          report_rows: report === "geography" ? geo.rows().length : null,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (err) {
      return upstreamFailure(err);
    }
  }

  const kind = report === "geography" ? "geography" : "records";
  const columns = exportColumns(profile, kind);
  async function* rows(): AsyncGenerator<FlatRow> {
    if (kind === "records") {
      for await (const { record, profile: p } of walk()) yield flattenRecord(record, p);
      return;
    }
    // The aggregated report needs the whole filtered set before its first row.
    const builder = new GeoReportBuilder();
    for await (const { record } of walk()) builder.add(record);
    for (const row of builder.rows()) yield flattenGeoRow(row, profile);
  }

  const exportedAt = new Date().toISOString();
  const fileFormat = format as FileFormat;
  const rowStream = rows();
  const body =
    fileFormat === "csv"
      ? csvStream(columns, rowStream)
      : fileFormat === "json"
        ? jsonStream(columns, profile, rowStream, {
            exported_at: exportedAt,
            report_type: report,
            range: { from: rangeFrom, to: rangeTo },
            filters,
            admin_profile: profile,
          })
        : xlsxStream(columns, rowStream, [
            ["exported_at", exportedAt],
            ["report_type", report],
            ["from", rangeFrom],
            ["to", rangeTo],
            ...Object.entries(filters).map(([k, v]) => [`filter_${k}`, v == null ? "" : String(v)] as [string, string]),
            ...Object.entries(profile).map(([k, v]) => [k, v == null ? "" : String(v)] as [string, string]),
          ]);

  return new Response(body, {
    headers: {
      "Content-Type": FILE_TYPES[fileFormat],
      "Content-Disposition": `attachment; filename="${exportFilename(fileFormat, report, rangeFrom, rangeTo)}"`,
      "Cache-Control": "no-store",
    },
  });
}
