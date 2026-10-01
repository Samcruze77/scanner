import { getAdminAnalytics } from "@/utils/admin/client.server";
import { defaultDateRange } from "@/utils/admin/dateRange";
import { getAdminLive } from "@/utils/admin/live.server";
import { DashboardClient } from "./DashboardClient";
import type { AdminAnalyticsResponse } from "@/utils/admin/types";

export default async function AdminDashboardPage() {
  const range = defaultDateRange();

  // Independent reads, run together rather than one after the other.
  const [analytics, live] = await Promise.allSettled([getAdminAnalytics(range.from, range.to), getAdminLive()]);
  const initialData: AdminAnalyticsResponse | null = analytics.status === "fulfilled" ? analytics.value : null;
  const onlineCount: number | null = live.status === "fulfilled" ? live.value.online_count : null;

  return <DashboardClient initialRange={range} initialData={initialData} onlineCount={onlineCount} />;
}
