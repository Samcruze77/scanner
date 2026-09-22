import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { GUIDES } from "@/utils/seo/guides";
import { pageMetadata } from "@/utils/seo/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Guides",
  absoluteTitle: "PDF and document guides - PDFScanner",
  description: "Short, practical guides to scanning, compressing, converting and signing documents, each one leading straight to the PDFScanner tool that does it.",
  path: "/guides",
});

export default function GuidesIndexPage() {
  return (
    <PageShell>
      <PageHeader title="Guides">Short, practical answers to real document questions, each one leading to the tool that does it.</PageHeader>
      <ul className="card divide-y divide-zinc-200 overflow-hidden dark:divide-zinc-800">
        {GUIDES.map((guide) => (
          <li key={guide.slug}>
            <Link href={`/guides/${guide.slug}`} className="flex min-h-14 flex-col gap-0.5 px-4 py-3 transition-colors hover:bg-hover">
              <span className="font-semibold">{guide.h1}</span>
              <span className="muted text-sm">{guide.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
