import { ExportsClient } from "./ExportsClient";
import { parseReportType } from "../../../supabase/functions/_shared/exportRows";
import { rangeFromParams, selectionFromParams, toURLSearchParams, type SearchParams } from "@/utils/admin/urlSelection";

// The selection arrives in the URL (from Geography's "Export this view",
// Analytics' "Export", or a shared link) and is parsed by the same code the
// export backend uses.
export default async function AdminExportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = toURLSearchParams(await searchParams);
  const { filters } = selectionFromParams(params);
  return (
    <ExportsClient
      initialRange={rangeFromParams(params, 30)}
      initialReportType={parseReportType(params.get("report_type")) ?? "full"}
      initialFilters={filters}
      autorun={params.has("from") || params.has("report_type")}
    />
  );
}
