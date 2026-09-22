import { notFound } from "next/navigation";
import { getAdCampaignDetail } from "@/utils/admin/ads.server";
import { CampaignDetailClient } from "./CampaignDetailClient";

export default async function AdminAdDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail = null;
  try {
    detail = await getAdCampaignDetail(id);
  } catch {
    detail = null;
  }
  if (!detail) notFound();

  return <CampaignDetailClient initial={detail} />;
}
