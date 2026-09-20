import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/layout/PageShell";
import { ToolCard } from "@/components/tools/ToolCard";
import { TOOL_GROUPS, toolsInGroup } from "@/utils/tools/registry";

export const metadata: Metadata = {
  title: "Tools - DocuScanner",
  description: "Edit, sign and compress documents for free, right in your browser. Nothing is uploaded.",
};

export default function ToolsHubPage() {
  return (
    <PageShell>
      <h1 className="mb-1 text-xl font-semibold">Tools</h1>
      <p className="mb-2 text-sm text-zinc-500">
        Edit, sign and compress your documents. Everything runs in your browser, so your files are never uploaded.
      </p>
      <p className="mb-6 text-sm text-zinc-500">
        Need to change a file&apos;s type, like Word to PDF? Use{" "}
        <Link href="/convert" className="inline-flex min-h-11 min-w-11 items-center justify-center font-medium text-zinc-900 underline dark:text-white">
          Convert
        </Link>
        .
      </p>

      <div className="space-y-8">
        {TOOL_GROUPS.map((group) => (
          <section key={group.id} aria-labelledby={`group-${group.id}`}>
            <h2 id={`group-${group.id}`} className="text-base font-semibold">
              {group.title}
            </h2>
            <p className="mb-3 text-sm text-zinc-500">{group.body}</p>
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
