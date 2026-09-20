import type { Metadata } from "next";
import { PageShell } from "@/components/layout/PageShell";
import { PdfToWordTool } from "@/components/convert/PdfToWordTool";

export const metadata: Metadata = {
  title: "PDF to Word converter - DocuScanner",
  description:
    "Convert a PDF to an editable Word document for free, right in your browser. Scanned PDFs are read with text recognition. Your file never leaves your device.",
};

export default function PdfToWordPage() {
  return (
    <PageShell>
      <h1 className="mb-1 text-xl font-semibold">PDF to Word</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Free, no account needed. The conversion happens in your browser, so your file is never uploaded.
      </p>
      <PdfToWordTool />
    </PageShell>
  );
}
