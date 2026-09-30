// Builds the download URL for an analytics export. The export itself is a
// plain GET to /api/admin/analytics-export authenticated by the admin's
// session cookie, so it works as a normal browser download and needs no
// client-side state: the whole selection (range + filters) is in the URL.

import type { ExportRequest } from "./types";

export function buildExportUrl(request: ExportRequest): string {
  const params = new URLSearchParams({
    format: request.format,
    report_type: request.reportType,
    from: request.dateRange.from,
    to: request.dateRange.to,
  });
  const filters = request.filters ?? {};
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, String(value));
  }
  return `/api/admin/analytics-export?${params.toString()}`;
}
