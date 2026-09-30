import { getAdminAnalytics } from "@/utils/admin/client.server";
import { GeographyClient } from "./GeographyClient";
import { rangeFromParams, selectionFromParams, toURLSearchParams, type SearchParams } from "@/utils/admin/urlSelection";
import type { AdminAnalyticsResponse } from "@/utils/admin/types";

export default async function AdminGeographyPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = toURLSearchParams(await searchParams);
  const range = rangeFromParams(params, 30);
  const { selection, filters } = selectionFromParams(params);

  let initialData: AdminAnalyticsResponse | null = null;
  try {
    initialData = await getAdminAnalytics(range.from, range.to, undefined, filters.device ?? undefined, filters.visitor_type ?? undefined);
  } catch {
    initialData = null;
  }

  return (
    <GeographyClient
      initialRange={range}
      initialData={initialData}
      initialSelection={selection}
      initialDevice={filters.device ?? ""}
      initialVisitorType={filters.visitor_type ?? ""}
    />
  );
}
