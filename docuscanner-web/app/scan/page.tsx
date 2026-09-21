import { ScannerWorkspace } from "@/components/scanner/ScannerWorkspace";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";

export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const initialMode = mode === "camera" || mode === "upload" ? mode : undefined;

  return (
    <PageShell width="workspace" ads="workflow">
      <PageHeader title="Scan, edit &amp; sign a document">
        Free to use as a guest, and everything happens in your browser. Sign in if you&apos;d like to save a document to your account.
      </PageHeader>
      <ScannerWorkspace initialMode={initialMode} />
    </PageShell>
  );
}
