import { getAdminAnalytics } from "@/utils/admin/client.server";
import { defaultDateRange } from "@/utils/admin/dateRange";
import { DashboardClient } from "./DashboardClient";
import type { AdminAnalyticsResponse } from "@/utils/admin/types";

export default async function AdminDashboardPage() {
  const range = defaultDateRange();

  let initialData: AdminAnalyticsResponse | null = null;
  try {
    // Same (from, to) as the layout's role check -- React's cache() means
    // this reuses that call instead of hitting the edge function twice.
    initialData = await getAdminAnalytics(range.from, range.to);
  } catch {
    initialData = null;
  }

  return <DashboardClient initialRange={range} initialData={initialData} />;
}
