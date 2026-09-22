import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { getVerifiedClaims } from "@/utils/supabase/claims";
import { createClient } from "@/utils/supabase/server";
import { RequireAuthPrompt } from "@/components/auth/RequireAuthPrompt";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Icon } from "@/components/ui/icons";
import { HistoryPrintButton } from "./HistoryPrintButton";

// Account-only content, different for every signed-in visitor: never indexed. `follow:
// true` (not the harsher `nofollow`) because the page itself links to real public pages
// (Scan a document) that are fine for a crawler to reach.
export const metadata: Metadata = {
  title: "Document history - PDFScanner",
  robots: { index: false, follow: true },
};

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
        <PageHeader title="Document history">Documents you&apos;ve saved to your account.</PageHeader>
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
      <PageHeader title="Document history">Documents you&apos;ve saved to your account. Download or print them from any device.</PageHeader>
      {withUrls.length === 0 ? (
        <div className="card flex flex-col items-start gap-3 p-6 text-sm">
          <p className="muted">No saved documents yet. Scan something and save it to your account.</p>
          <Link href="/scan" className="btn btn-primary">
            <Icon name="camera" size={18} />
            Scan a document
          </Link>
        </div>
      ) : (
        <ul className="card divide-y divide-zinc-200 overflow-hidden dark:divide-zinc-800">
          {withUrls.map((doc) => (
            <li key={doc.id} className="flex flex-col gap-3 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-medium">{doc.title}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {doc.page_count ?? "?"} page{doc.page_count === 1 ? "" : "s"} ·{" "}
                  {new Date(doc.created_at).toLocaleDateString()}
                </p>
              </div>
              {doc.downloadUrl && (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <HistoryPrintButton url={doc.downloadUrl} title={doc.title} />
                  <a href={doc.downloadUrl} className="btn btn-secondary">
                    <Icon name="download" size={18} />
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
