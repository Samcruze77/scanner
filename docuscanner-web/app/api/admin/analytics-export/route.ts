// Admin analytics download (CSV / XLSX / JSON).
//
// A plain GET authenticated by the admin's session cookie, so the browser
// downloads it natively and nothing depends on client-side state. All data
// and the authorization decision come from the `admin-analytics-export` Edge
// Function (active admin_users row, role super_admin/admin), called with the
// caller's own access token -- this route holds no service credentials and
// reads no table itself. The Edge Function is paged by primary-key cursor;
// this route walks every page and streams the file, so size is bounded by the
// database, not by a UI page limit.
//
// Filters come from the same query parameters the dashboard sends
// (see utils/admin/invoke.ts) and are parsed by the same shared code.

import { PassThrough, Readable } from "node:stream";
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getVerifiedClaims } from "@/utils/supabase/claims";
import {
  CSV_BOM,
  CSV_HEADER,
  EXPORT_COLUMNS,
  csvLine,
  exportFilename,
  flattenRecord,
  jsonRecord,
  xlsxRow,
  type FlatRow,
} from "@/utils/admin/exportFile";
import { walkExport } from "@/utils/admin/exportPaging";
import { parseFilters, resolveRange } from "../../../../supabase/functions/_shared/analyticsFilters";
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

const FORMATS = { csv: "text/csv; charset=utf-8", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", json: "application/json; charset=utf-8" } as const;
type Format = keyof typeof FORMATS;

class UpstreamError extends Error {
  constructor(public status: number) {
    super(`export source responded ${status}`);
  }
}

// Query string forwarded to the Edge Function: exactly the caller's
// selection (range + filters), never anything else from the request.
const FORWARDED = ["from", "to", "days", "country", "state_province", "region", "city_town", "city", "county_district_lga", "neighborhood_suburb", "device", "visitor_type", "report_type"];

async function fetchPage(token: string, base: URLSearchParams, dataset: ExportDataset, after: number): Promise<ExportPage> {
  const params = new URLSearchParams(base);
  params.set("dataset", dataset);
  params.set("after", String(after));
  params.set("limit", String(PAGE_SIZE));
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-analytics-export?${params}`, {
    headers: { Authorization: `Bearer ${token}`, apikey: PUBLISHABLE_KEY },
    cache: "no-store",
  });
  if (!res.ok) throw new UpstreamError(res.status);
  return (await res.json()) as ExportPage;
}

async function* records(token: string, base: URLSearchParams, datasets: ExportDataset[], first: ExportPage): AsyncGenerator<FlatRow> {
  for await (const { record, profile } of walkExport((dataset, after) => fetchPage(token, base, dataset, after), datasets, first)) {
    yield flattenRecord(record, profile);
  }
}

function csvStream(rows: AsyncGenerator<FlatRow>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(CSV_BOM + CSV_HEADER));
    },
    async pull(controller) {
      try {
        const { value, done } = await rows.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(csvLine(value)));
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

function jsonStream(rows: AsyncGenerator<FlatRow>, meta: Record<string, unknown>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let count = 0;
  return new ReadableStream({
    start(controller) {
      const head = JSON.stringify(meta).slice(0, -1);
      controller.enqueue(encoder.encode(`${head},"columns":${JSON.stringify(EXPORT_COLUMNS)},"records":[`));
    },
    async pull(controller) {
      try {
        const { value, done } = await rows.next();
        if (done) {
          controller.enqueue(encoder.encode(`],"record_count":${count}}`));
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode((count++ ? "," : "") + JSON.stringify(jsonRecord(value))));
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

function xlsxStream(rows: AsyncGenerator<FlatRow>, info: [string, string][]): ReadableStream<Uint8Array> {
  const out = new PassThrough();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: false, useSharedStrings: false });
  (async () => {
    const sheet = workbook.addWorksheet("Analytics export");
    sheet.addRow([...EXPORT_COLUMNS]).commit();
    for await (const row of rows) sheet.addRow(xlsxRow(row)).commit();
    sheet.commit();
    const infoSheet = workbook.addWorksheet("Export info");
    for (const line of info) infoSheet.addRow(line).commit();
    infoSheet.commit();
    await workbook.commit();
  })().catch((err) => out.destroy(err));
  return Readable.toWeb(out) as unknown as ReadableStream<Uint8Array>;
}

export async function GET(request: Request) {
  const { claims } = await getVerifiedClaims();
  if (!claims) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "csv") as Format;
  if (!(format in FORMATS)) return NextResponse.json({ error: "Unsupported format" }, { status: 400 });
  const report = parseReportType(url.searchParams.get("report_type") ?? "full");
  if (!report) return NextResponse.json({ error: "Invalid report_type" }, { status: 400 });
  const range = resolveRange(url.searchParams);
  if (range.ok === false) return NextResponse.json({ error: range.error }, { status: 400 });

  // Only the verified caller's own token is ever forwarded; the Edge
  // Function re-verifies it and checks admin_users itself.
  const supabase = createClient(await cookies());
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token || !SUPABASE_URL) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const base = new URLSearchParams();
  for (const name of FORWARDED) {
    const value = url.searchParams.get(name);
    if (value) base.set(name, value);
  }
  base.set("report_type", report);

  const plan = planFor(report);
  let first: ExportPage;
  try {
    first = await fetchPage(token, base, plan.datasets[0], 0);
  } catch (err) {
    const status = err instanceof UpstreamError && [401, 403, 400].includes(err.status) ? err.status : 502;
    return NextResponse.json({ error: status === 502 ? "Export is unavailable" : status === 400 ? "Invalid export request" : "Forbidden" }, { status });
  }

  const filters = parseFilters(url.searchParams);
  const exportedAt = new Date().toISOString();
  const rangeFrom = range.from.toISOString().slice(0, 10);
  const rangeTo = range.to.toISOString().slice(0, 10);
  const meta = {
    exported_at: exportedAt,
    report_type: report,
    range: { from: rangeFrom, to: rangeTo },
    filters,
    admin_profile: first.profile,
  };
  const rows = records(token, base, plan.datasets, first);

  const body =
    format === "csv"
      ? csvStream(rows)
      : format === "json"
        ? jsonStream(rows, meta)
        : xlsxStream(rows, [
            ["exported_at", exportedAt],
            ["report_type", report],
            ["from", rangeFrom],
            ["to", rangeTo],
            ...Object.entries(filters).map(([k, v]) => [`filter_${k}`, v == null ? "" : String(v)] as [string, string]),
            ...Object.entries(first.profile).map(([k, v]) => [k, v == null ? "" : String(v)] as [string, string]),
          ]);

  return new Response(body, {
    headers: {
      "Content-Type": FORMATS[format],
      "Content-Disposition": `attachment; filename="${exportFilename(format, report, rangeFrom, rangeTo)}"`,
      "Cache-Control": "no-store",
    },
  });
}
