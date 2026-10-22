import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { Icon } from "@/components/ui/icons";
import { ToolCard } from "@/components/tools/ToolCard";
import { pageMetadata } from "@/utils/seo/metadata";
import { TOOL_GROUPS, toolsInGroup } from "@/utils/tools/registry";

export const metadata: Metadata = pageMetadata({
  title: "Tools",
  absoluteTitle: "Tools - FreePDFScanner",
  description: "Edit, sign, compress and password-protect documents for free, right in your browser. Nothing is uploaded.",
  path: "/tools",
});

export default function ToolsHubPage() {
  return (
    <PageShell>
      <PageHeader title="Tools">
        Edit, sign, compress and password-protect your documents. Everything runs in your browser, so your files are never uploaded. To change a
        file&apos;s type, like Word to PDF, use{" "}
        <Link href="/convert" className="link-inline">
          Convert
        </Link>
        .
      </PageHeader>

      <section aria-labelledby="group-create" className="mb-8">
        <h2 id="group-create" className="section-title">
          Create
        </h2>
        <p className="muted mb-3 mt-0.5 text-sm">Start a new document from a blank page.</p>
        <ul className="grid gap-3 sm:grid-cols-2">
          <li>
            <Link
              href="/create-word-document"
              className="card group flex h-full min-h-14 items-start gap-3 p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/40 dark:hover:border-blue-800 dark:hover:bg-blue-950/30"
            >
              <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                <Icon name="document" size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-semibold">Create Word Document</span>
                <span className="muted mt-0.5 block text-sm">Write a new document on a blank page and download it as a Word (.docx) file. Free, no account, and nothing is uploaded.</span>
              </span>
            </Link>
          </li>
        </ul>
      </section>

      <div className="space-y-8">
        {TOOL_GROUPS.map((group) => (
          <section key={group.id} aria-labelledby={`group-${group.id}`}>
            <h2 id={`group-${group.id}`} className="section-title">
              {group.title}
            </h2>
            <p className="muted mb-3 mt-0.5 text-sm">{group.body}</p>
            <ul className="grid gap-3 sm:grid-cols-2">
              {toolsInGroup(group.id).map((tool) => (
                <li key={tool.slug}>
                  <ToolCard tool={tool} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PageShell>
  );
}
