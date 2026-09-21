import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/layout/PageShell";
import { ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { getToolBySlug, TOOLS } from "@/utils/tools/registry";

export function generateStaticParams() {
  return TOOLS.map((tool) => ({ slug: tool.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const tool = getToolBySlug(slug);
  if (!tool) return {};
  return { title: `${tool.title} - PDFScanner`, description: `${tool.body} Free, in your browser.` };
}

export default async function ToolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tool = getToolBySlug(slug);
  if (!tool) notFound();

  return (
    <PageShell width={tool.kind === "editor" ? "workspace" : "narrow"} ads="workflow">
      <ToolWorkspace tool={tool} />
    </PageShell>
  );
}
