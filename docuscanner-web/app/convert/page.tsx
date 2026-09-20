import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/layout/PageShell";
import { CONVERT_TOOLS, SCAN_TOOL } from "@/components/convert/tools";

export const metadata: Metadata = {
  title: "Convert files - DocuScanner",
  description: "Scan, edit and sign documents, and convert between Word, PDF and Excel. Free, in your browser.",
};

export default function ConvertHubPage() {
  return (
    <PageShell>
      <h1 className="mb-1 text-xl font-semibold">Convert</h1>
      <p className="mb-2 text-sm text-zinc-500">
        Everything runs in your browser, so your files are never uploaded.
      </p>
      <p className="mb-6 text-sm text-zinc-500">
        Use Convert to change a file&apos;s type. To edit, sign or compress a file, use{" "}
        <Link href="/tools" className="inline-flex min-h-11 min-w-11 items-center justify-center font-medium text-zinc-900 underline dark:text-white">
          Tools
        </Link>
        .
      </p>
      <ul className="grid gap-4 sm:grid-cols-2">
        {[SCAN_TOOL, ...CONVERT_TOOLS].map((tool) => (
          <li key={tool.href}>
            <Link
              href={tool.href}
              className="block h-full rounded-lg border border-zinc-200 p-5 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              <h2 className="font-semibold">{tool.title}</h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{tool.body}</p>
            </Link>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
