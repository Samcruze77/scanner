import type { Metadata } from "next";
import { PageShell } from "@/components/layout/PageShell";
import { ScannerWorkspace } from "@/components/scanner/ScannerWorkspace";

export const metadata: Metadata = {
  title: "Image to PDF converter - DocuScanner",
  description:
    "Turn photos and pictures into one clean PDF for free, right in your browser. Crop, enhance and reorder pages first. Your pictures never leave your device.",
};

export default function ImageToPdfPage() {
  return (
    <PageShell>
      <h1 className="mb-1 text-xl font-semibold">Image to PDF</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Add one or more pictures, crop and reorder them, then create one PDF. Free, no account needed. Your pictures stay
        on your device.
      </p>
      <ScannerWorkspace />
    </PageShell>
  );
}
