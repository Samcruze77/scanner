import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/layout/PageShell";
import { JsonLd } from "@/components/seo/JsonLd";
import { RelatedTools } from "@/components/seo/SeoContent";
import { GUIDES, getGuide } from "@/utils/seo/guides";
import { pageMetadata } from "@/utils/seo/metadata";
import { articleSchema, breadcrumbSchema, graph, webPageSchema } from "@/utils/seo/schema";

export function generateStaticParams() {
  return GUIDES.map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) return {};
  return pageMetadata({
    title: guide.title,
    absoluteTitle: `${guide.h1} - PDFScanner`,
    description: guide.description,
    path: `/guides/${slug}`,
    type: "article",
  });
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = getGuide(slug);
  if (!guide) notFound();
  const path = `/guides/${slug}`;

  return (
    <PageShell width="narrow">
      <JsonLd
        data={graph(
          articleSchema(path, guide.h1, guide.description, guide.published, guide.updated),
          webPageSchema(path, guide.h1, guide.description),
          breadcrumbSchema(path, [{ name: "Guides", path: "/guides" }, { name: guide.h1, path }]),
        )}
      />
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        <Link href="/guides" className="inline-flex min-h-11 items-center hover:underline">
          Guides
        </Link>
        <span aria-hidden> / </span>
        <span>{guide.h1}</span>
      </nav>

      <h1 className="page-title">{guide.h1}</h1>
      <p className="muted mt-2 text-base leading-7">{guide.intro}</p>

      <div className="mt-8 space-y-8">
        {guide.sections.map((section) => (
          <section key={section.h2}>
            <h2 className="section-title">{section.h2}</h2>
            {section.paragraphs?.map((p) => (
              <p key={p} className="muted mt-3 text-sm leading-6">
                {p}
              </p>
            ))}
            {section.steps && (
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6">
                {section.steps.map((step) => (
                  <li key={step} className="pl-1">
                    {step}
                  </li>
                ))}
              </ol>
            )}
            {section.bullets && (
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6">
                {section.bullets.map((b) => (
                  <li key={b} className="pl-1">
                    {b}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <div className="card mt-10 flex flex-col items-start gap-3 p-5">
        <p className="font-semibold">{guide.tool.blurb}</p>
        <Link href={guide.tool.href} className="btn btn-primary">
          {guide.tool.label}
        </Link>
      </div>

      <div className="mt-10">
        <RelatedTools links={guide.related} heading="Related tools" />
      </div>
    </PageShell>
  );
}
