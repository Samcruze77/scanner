import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { ToolCard } from "@/components/tools/ToolCard";
import { pageMetadata } from "@/utils/seo/metadata";
import { TOOL_GROUPS, toolsInGroup } from "@/utils/tools/registry";

export const metadata: Metadata = pageMetadata({
  title: "Tools",
  absoluteTitle: "Tools - PDFScanner",
  description: "Edit, sign and compress documents for free, right in your browser. Nothing is uploaded.",
  path: "/tools",
});

export default function ToolsHubPage() {
  return (
    <PageShell>
      <PageHeader title="Tools">
        Edit, sign and compress your documents. Everything runs in your browser, so your files are never uploaded. To change a
        file&apos;s type, like Word to PDF, use{" "}
        <Link href="/convert" className="link-inline">
          Convert
        </Link>
        .
      </PageHeader>

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
