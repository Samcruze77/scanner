import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { GUIDES } from "@/utils/seo/guides";
import { JsonLd } from "@/components/seo/JsonLd";
import { pageMetadata } from "@/utils/seo/metadata";
import { breadcrumbSchema, graph, webPageSchema } from "@/utils/seo/schema";

export const metadata: Metadata = pageMetadata({
  title: "PDF Guides: Scan, Compress, Sign & Convert",
  description: "Practical guides to scanning, compressing, converting, signing and password-protecting PDFs, each leading straight to the free FreePDFScanner tool that does it.",
  path: "/guides",
});

export default function GuidesIndexPage() {
  return (
    <PageShell>
      <JsonLd data={graph(webPageSchema("/guides", "PDF and document guides", "Practical guides to scanning, compressing, converting, signing and password-protecting documents."), breadcrumbSchema("/guides", [{ name: "Guides", path: "/guides" }]))} />
      <PageHeader title="PDF and document guides">Short, practical answers to real document questions, each one leading to the tool that does it.</PageHeader>
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
