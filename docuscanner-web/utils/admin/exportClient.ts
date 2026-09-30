// URL builders for the analytics report backend. Every entry point (the Export
// page, Geography's "Export this view", Analytics' "Export") builds its URLs
// here, so there is one canonical way to describe a report selection.
//
//   buildExportPageUrl  -> /admin/exports?...   (configure, preview, generate)
//   buildExportUrl      -> /api/admin/analytics-export?... (summary / files)

import type { DownloadExportFormat, ExportRequest } from "./types";

function selectionParams(request: ExportRequest): URLSearchParams {
  const params = new URLSearchParams({
    report_type: request.reportType,
    from: request.dateRange.from,
    to: request.dateRange.to,
  });
  for (const [key, value] of Object.entries(request.filters ?? {})) {
    if (value) params.set(key, String(value));
  }
  return params;
}

export function buildExportPageUrl(request: ExportRequest): string {
  return `/admin/exports?${selectionParams(request).toString()}`;
}

export function buildExportUrl(request: ExportRequest, format: DownloadExportFormat | "summary"): string {
  const params = selectionParams(request);
  params.set("format", format);
  return `/api/admin/analytics-export?${params.toString()}`;
}
