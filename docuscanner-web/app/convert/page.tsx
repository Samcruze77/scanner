import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { CONVERT_TOOLS, SCAN_TOOL } from "@/components/convert/tools";
import { Icon, type IconName } from "@/components/ui/icons";

export const metadata: Metadata = {
  title: "Convert files - DocuScanner",
  description: "Scan, edit and sign documents, and convert between Word, PDF and Excel. Free, in your browser.",
};

const ICONS: Record<string, IconName> = {
  "/scan": "camera",
  "/convert/image-to-pdf": "image",
  "/convert/word-to-pdf": "document",
  "/convert/pdf-to-word": "document",
  "/convert/excel-to-pdf": "documents",
  "/convert/pdf-to-excel": "documents",
};

export default function ConvertHubPage() {
  return (
    <PageShell>
      <PageHeader title="Convert">
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
    </PageShell>
  );
}
