import { getAdminAuditLog } from "@/utils/admin/audit.server";

export default async function AdminAuditPage() {
  let data = null;
  try {
    data = await getAdminAuditLog();
  } catch {
    data = null;
  }

  if (!data) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Couldn&apos;t load the audit log.</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Audit Log</h1>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2">Admin</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Details</th>
              <th className="px-3 py-2">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {data.logs.map((l) => (
              <tr key={l.id}>
                <td className="px-3 py-2">{l.admin_label}</td>
                <td className="px-3 py-2">{l.action}</td>
                <td className="px-3 py-2 font-mono text-xs">{l.target_type ? `${l.target_type}:${l.target_id}` : "—"}</td>
                <td className="px-3 py-2 max-w-xs truncate font-mono text-xs" title={JSON.stringify(l.metadata)}>
                  {JSON.stringify(l.metadata)}
                </td>
                <td className="px-3 py-2">{new Date(l.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {data.logs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-400">No administrative actions recorded yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
