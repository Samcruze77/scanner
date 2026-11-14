// A keyword page: one task explained for the person who searched for exactly that, with a button into
// the tool that does it (the tool itself lives on its own route, so this is not a second copy of it).
// All of its words come from utils/seo/landing.ts.

import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/PageHeader";
import { PageShell } from "@/components/layout/PageShell";
import { JsonLd } from "@/components/seo/JsonLd";
import { SeoContent } from "@/components/seo/SeoContent";
import { ToolCta } from "@/components/seo/ToolCta";
import { getLanding, type LandingPage } from "@/utils/seo/landing";
import { pageMetadata } from "@/utils/seo/metadata";
import { breadcrumbSchema, graph, webPageSchema } from "@/utils/seo/schema";

function landingFor(path: string): LandingPage {
  const landing = getLanding(path);
  if (!landing) throw new Error(`no landing page for ${path}`);
  return landing;
}

export function keywordLandingMetadata(path: string): Metadata {
  const landing = landingFor(path);
  return pageMetadata({ title: landing.title, description: landing.description, path });
}

export function KeywordLanding({ path }: { path: string }) {
  const landing = landingFor(path);
  return (
    <PageShell>
      <JsonLd data={graph(webPageSchema(path, landing.h1, landing.description), breadcrumbSchema(path, landing.crumbs))} />
      <PageHeader title={landing.h1}>{landing.intro}</PageHeader>
      {landing.cta && <ToolCta href={landing.cta.href} label={landing.cta.label} />}
      <SeoContent page={landing} />
    </PageShell>
  );
}
