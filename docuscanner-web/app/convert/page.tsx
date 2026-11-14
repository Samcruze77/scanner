import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { CONVERT_TOOLS, SCAN_TOOL } from "@/components/convert/tools";
import { Icon, type IconName } from "@/components/ui/icons";
import { JsonLd } from "@/components/seo/JsonLd";
import { RELATED } from "@/utils/seo/landing";
import { pageMetadata } from "@/utils/seo/metadata";
import { breadcrumbSchema, graph, webPageSchema } from "@/utils/seo/schema";

export const metadata: Metadata = pageMetadata({
  title: "Free File Converter: PDF, Word, Excel, JPG",
  description: "Convert Word, Excel and images to PDF, and PDF to Word or Excel, for free. Everything is converted in your browser, so your files are never uploaded.",
  path: "/convert",
});

const ICONS: Record<string, IconName> = {
  "/scan": "camera",
  "/convert/image-to-pdf": "image",
  "/convert/word-to-pdf": "document",
  "/convert/pdf-to-word": "document",
  "/convert/excel-to-pdf": "documents",
  "/convert/pdf-to-excel": "documents",
};

// More specific conversions, each with its own page explaining the steps and limits.
const MORE: { href: string; label: string; note: string }[] = [
  { href: "/jpg-to-pdf", label: "JPG to PDF", note: "Turn one or several JPG photos into a single PDF." },
  { href: "/png-to-pdf", label: "PNG to PDF", note: "Turn PNG images and screenshots into a PDF." },
  { href: "/scan-to-pdf", label: "Scan to PDF", note: "Use your phone or computer camera as a document scanner." },
  { href: "/pdf-to-text", label: "PDF to text", note: "Get the words of a PDF or scan as a plain .txt file." },
  { href: "/pdf-to-csv", label: "PDF to CSV", note: "Get the lines of a PDF or scan as a .csv file." },
  { href: RELATED.imageToText.href, label: "Image to text", note: "Copy the words out of a photo or screenshot." },
  { href: RELATED.mergePdf.href, label: "Merge PDF files", note: "Combine several PDFs, photos and documents into one PDF." },
  { href: RELATED.createWord.href, label: "Create a Word document", note: "Write a new document and download a real .docx." },
];

export default function ConvertHubPage() {
  return (
    <PageShell>
      <JsonLd data={graph(webPageSchema("/convert", "Convert files to and from PDF", "Convert Word, Excel and images to PDF, and PDF to Word or Excel, free, in your browser."), breadcrumbSchema("/convert", [{ name: "Convert", path: "/convert" }]))} />
      <PageHeader title="Convert files to and from PDF">
        Change a file&apos;s type without uploading it: everything runs in your browser. To edit, sign or compress a file, use{" "}
        <Link href="/tools" className="link-inline">
          Tools
        </Link>
        .
      </PageHeader>
      <ul className="grid gap-3 sm:grid-cols-2">
        {[SCAN_TOOL, ...CONVERT_TOOLS].map((tool) => (
          <li key={tool.href}>
            <Link
              href={tool.href}
              className="card group flex h-full items-start gap-3 p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/40 dark:hover:border-blue-800 dark:hover:bg-blue-950/30"
            >
              <span
                aria-hidden
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400"
              >
                <Icon name={ICONS[tool.href] ?? "document"} size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <h2 className="font-semibold">{tool.title}</h2>
                <p className="muted mt-0.5 text-sm">{tool.body}</p>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <section aria-labelledby="more-conversions" className="mt-10">
        <h2 id="more-conversions" className="section-title">
          More conversions
        </h2>
        <p className="muted mt-2 max-w-2xl text-sm leading-6">
          Every conversion happens on your own device: the file is read by your browser and is not sent to a server, so it works for private
          documents too. There is no account to create, no watermark on the result, and no daily limit.
        </p>
        <ul className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {MORE.map((item) => (
            <li key={item.href} className="text-sm leading-6">
              <Link href={item.href} className="link-inline font-medium">
                {item.label}
              </Link>
              <span className="muted block">{item.note}</span>
            </li>
          ))}
        </ul>
      </section>
    </PageShell>
  );
}
