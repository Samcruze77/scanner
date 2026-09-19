import { ScannerWorkspace } from "@/components/scanner/ScannerWorkspace";
import { AdSlot } from "@/components/ads/AdSlot";

export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  const initialMode = mode === "camera" || mode === "upload" ? mode : undefined;

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">
      <AdSlot variant="top-banner" className="mb-6" />
      <AdSlot variant="mobile-banner" className="mb-6" />
      <h1 className="mb-1 text-xl font-semibold">Scan a document</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Free to use as a guest. Sign in if you&apos;d like to save it to your account.
      </p>
      <ScannerWorkspace initialMode={initialMode} />
    </main>
  );
}
