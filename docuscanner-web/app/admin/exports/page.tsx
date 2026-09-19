import { ExportsClient } from "./ExportsClient";

// No backend export-job API exists yet (see utils/admin/exportClient.ts),
// so there's nothing to fetch server-side here -- ExportsClient renders the
// UI foundation and reports export actions as pending.
export default function AdminExportsPage() {
  return <ExportsClient />;
}
