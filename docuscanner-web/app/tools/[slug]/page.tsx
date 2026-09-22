import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/layout/PageShell";
import { ToolWorkspace } from "@/components/tools/ToolWorkspace";
import { JsonLd } from "@/components/seo/JsonLd";
import { SeoContent } from "@/components/seo/SeoContent";
import { getLanding } from "@/utils/seo/landing";
import { pageMetadata } from "@/utils/seo/metadata";
import { breadcrumbSchema, graph, webApplicationSchema, webPageSchema } from "@/utils/seo/schema";
import { TOOL_CANONICAL_OVERRIDE } from "@/utils/seo/toolCanonicals";
import { getToolBySlug, TOOLS } from "@/utils/tools/registry";

export function generateStaticParams() {
  return TOOLS.map((tool) => ({ slug: tool.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const tool = getToolBySlug(slug);
  if (!tool) return {};
  const path = `/tools/${slug}`;
  const canonical = TOOL_CANONICAL_OVERRIDE[slug] ?? path;
  const landing = getLanding(path);
  return pageMetadata({
    title: landing?.title ?? tool.title,
    absoluteTitle: landing ? `${landing.h1} - PDFScanner` : `${tool.title} - PDFScanner`,
    description: landing?.description ?? `${tool.body} Free, in your browser.`,
    // A near-duplicate tool (e.g. Draw, Highlight) canonicalizes to the fuller editor it's
    // part of -- see utils/seo/toolCanonicals.ts -- so its own URL is never what search
    // engines are pointed at, without hiding or disabling the page itself.
    path: canonical,
  });
}

export default async function ToolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tool = getToolBySlug(slug);
  if (!tool) notFound();
  const path = `/tools/${slug}`;
  const landing = getLanding(path);

  return (
    <PageShell width={tool.kind === "editor" ? "workspace" : "narrow"} ads="workflow">
      {landing && (
        <JsonLd
          data={graph(
            webApplicationSchema(TOOL_CANONICAL_OVERRIDE[slug] ?? path, landing.appName, landing.description, landing.features),
            webPageSchema(TOOL_CANONICAL_OVERRIDE[slug] ?? path, landing.h1, landing.description),
            // Matches the breadcrumb ToolWorkspace already renders (Tools / <tool title>).
            breadcrumbSchema(TOOL_CANONICAL_OVERRIDE[slug] ?? path, [{ name: "Tools", path: "/tools" }, { name: tool.title, path }]),
          )}
        />
      )}
      <ToolWorkspace tool={tool} heading={landing?.h1} />
      {landing && <SeoContent page={landing} />}
    </PageShell>
  );
}
