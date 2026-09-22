import { getAdminDocuments } from "@/utils/admin/documents.server";

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function AdminDocumentsPage() {
  let data = null;
  try {
    data = await getAdminDocuments();
  } catch {
    data = null;
  }

  if (!data) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Couldn&apos;t load documents.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Documents</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Only documents a user explicitly saved to their account (Storage bucket <code>documents</code>). Scans and conversions
          that stayed in the browser never appear here -- the app doesn&apos;t upload them just to make them visible in Admin.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Pages</th>
              <th className="px-3 py-2">Size</th>
              <th className="px-3 py-2">Saved</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-900">
            {data.documents.map((d) => (
              <tr key={d.id}>
                <td className="px-3 py-2">{d.title}</td>
                <td className="px-3 py-2">{d.owner_label}</td>
                <td className="px-3 py-2">{d.mime_type}</td>
                <td className="px-3 py-2">{d.page_count ?? "—"}</td>
                <td className="px-3 py-2">{fmtBytes(d.file_size)}</td>
                <td className="px-3 py-2">{new Date(d.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {data.documents.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-400">No documents stored yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
