import { cookies } from "next/headers";
import { getVerifiedClaims } from "@/utils/supabase/claims";
import { createClient } from "@/utils/supabase/server";
import { RequireAuthPrompt } from "@/components/auth/RequireAuthPrompt";
import { PageShell } from "@/components/layout/PageShell";
import { HistoryPrintButton } from "./HistoryPrintButton";

interface DocumentRow {
  id: string;
  title: string;
  file_size: number;
  page_count: number | null;
  created_at: string;
  storage_path: string;
}

const SIGNED_URL_TTL_SECONDS = 60 * 10;

export default async function HistoryPage() {
  const { claims } = await getVerifiedClaims();

  if (!claims) {
    return (
      <PageShell width="narrow">
        <h1 className="mb-4 text-xl font-semibold">Document history</h1>
        <RequireAuthPrompt message="Sign in to see documents you've saved to your account." />
      </PageShell>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: documents } = await supabase
    .from("documents")
    .select("id, title, file_size, page_count, created_at, storage_path")
    .order("created_at", { ascending: false });

  const rows = (documents ?? []) as DocumentRow[];

  const withUrls = await Promise.all(
    rows.map(async (doc) => {
      const { data } = await supabase.storage
        .from("documents")
        .createSignedUrl(doc.storage_path, SIGNED_URL_TTL_SECONDS);
      return { ...doc, downloadUrl: data?.signedUrl ?? null };
    }),
  );

  return (
    <PageShell width="narrow">
      <h1 className="mb-4 text-xl font-semibold">Document history</h1>
      {withUrls.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No saved documents yet. Scan something and save it to your account.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {withUrls.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{doc.title}</p>
                <p className="text-xs text-zinc-500">
                  {doc.page_count ?? "?"} page{doc.page_count === 1 ? "" : "s"} ·{" "}
                  {new Date(doc.created_at).toLocaleDateString()}
                </p>
              </div>
              {doc.downloadUrl && (
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  <HistoryPrintButton url={doc.downloadUrl} title={doc.title} />
                  <a
                    href={doc.downloadUrl}
                    className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium dark:border-zinc-700"
                  >
                    Download
                  </a>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
