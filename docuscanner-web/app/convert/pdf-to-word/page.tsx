import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { PdfToWordTool } from "@/components/convert/PdfToWordTool";

export const metadata: Metadata = {
  title: "PDF to Word converter - PDFScanner",
  description:
    "Convert a PDF to an editable Word document for free, right in your browser. Scanned PDFs are read with text recognition. Your file never leaves your device.",
};

export default function PdfToWordPage() {
  return (
    <PageShell width="narrow" ads="workflow">
      <PageHeader title="PDF to Word">
        Free, no account needed. The conversion happens in your browser, so your file is never uploaded.
      </PageHeader>
      <PdfToWordTool />
    </PageShell>
  );
}
