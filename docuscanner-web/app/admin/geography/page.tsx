import { getAdminAnalytics } from "@/utils/admin/client.server";
import { defaultDateRange } from "@/utils/admin/dateRange";
import { GeographyClient } from "./GeographyClient";
import type { AdminAnalyticsResponse } from "@/utils/admin/types";

export default async function AdminGeographyPage() {
  const range = defaultDateRange(30);

  let initialData: AdminAnalyticsResponse | null = null;
  try {
    initialData = await getAdminAnalytics(range.from, range.to);
  } catch {
    initialData = null;
  }

  return <GeographyClient initialRange={range} initialData={initialData} />;
}
