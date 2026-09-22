import { notFound } from "next/navigation";
import { getAdminUserDetail } from "@/utils/admin/users.server";
import { UserDetailClient } from "./UserDetailClient";

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail = null;
  try {
    detail = await getAdminUserDetail(id);
  } catch {
    detail = null;
  }
  if (!detail) notFound();

  return <UserDetailClient id={id} initial={detail} />;
}
