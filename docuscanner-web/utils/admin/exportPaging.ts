// Walks every page of every dataset in a report, in order. Pure and
// transport-agnostic (the route supplies `fetchPage`), so paging behaviour --
// nothing dropped, nothing repeated, no dependence on a UI page size -- is
// unit tested against a fake paged source (tests/analytics/export.mjs).

import type { ExportDataset, ExportPage, ExportRecord } from "../../supabase/functions/_shared/exportRows.ts";
import type { AdminProfileRecord as AdminProfile } from "../../supabase/functions/_shared/adminProfile.ts";

export type FetchPage = (dataset: ExportDataset, after: number) => Promise<ExportPage>;

// `first` is the already-fetched first page of datasets[0], so a caller can
// turn auth/validation failures into an HTTP status before streaming starts.
export async function* walkExport(
  fetchPage: FetchPage,
  datasets: ExportDataset[],
  first: ExportPage,
): AsyncGenerator<{ record: ExportRecord; profile: AdminProfile }> {
  for (const [index, dataset] of datasets.entries()) {
    let current = index === 0 ? first : await fetchPage(dataset, 0);
    for (;;) {
      for (const record of current.rows) yield { record, profile: current.profile };
      if (current.next_after === null) break;
      current = await fetchPage(dataset, current.next_after);
    }
  }
}
