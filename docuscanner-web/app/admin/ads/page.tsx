import { getAdCampaigns } from "@/utils/admin/ads.server";
import { AdsClient } from "./AdsClient";

export default async function AdminAdsPage() {
  let initial = null;
  try {
    initial = await getAdCampaigns();
  } catch {
    initial = null;
  }

  return <AdsClient initial={initial} />;
}
