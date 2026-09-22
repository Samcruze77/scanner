import { getAdminLive } from "@/utils/admin/live.server";
import { LiveClient } from "./LiveClient";

export default async function AdminLivePage() {
  let initial = null;
  try {
    initial = await getAdminLive();
  } catch {
    initial = null;
  }

  return <LiveClient initial={initial} />;
}
