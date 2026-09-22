import { getAdminUsers } from "@/utils/admin/users.server";
import { UsersClient } from "./UsersClient";

export default async function AdminUsersPage() {
  let initial = null;
  try {
    initial = await getAdminUsers({ limit: 50 });
  } catch {
    initial = null;
  }

  return <UsersClient initial={initial} />;
}
