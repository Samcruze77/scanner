import { ScannerWorkspace } from "@/components/scanner/ScannerWorkspace";
import { PageShell } from "@/components/layout/PageShell";

export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const initialMode = mode === "camera" || mode === "upload" ? mode : undefined;

  return (
    <PageShell>
      <h1 className="mb-1 text-xl font-semibold">Scan, edit &amp; sign a document</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Free to use as a guest. Everything happens in your browser. Sign in if you&apos;d like to save a document to your account.
      </p>
      <ScannerWorkspace initialMode={initialMode} />
    </PageShell>
  );
}
