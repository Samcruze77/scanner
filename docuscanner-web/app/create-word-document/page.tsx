import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/layout/PageShell";
import { JsonLd } from "@/components/seo/JsonLd";
import { SeoContent } from "@/components/seo/SeoContent";
import { WordCreatorLoader } from "@/components/wordCreator/WordCreatorLoader";
import { getLanding } from "@/utils/seo/landing";
import { pageMetadata } from "@/utils/seo/metadata";
import { breadcrumbSchema, graph, webApplicationSchema, webPageSchema } from "@/utils/seo/schema";

const landing = getLanding("/create-word-document")!;

export const metadata: Metadata = pageMetadata({
  title: landing.title,
  absoluteTitle: `${landing.h1} - FreePDFScanner`,
  description: landing.description,
  path: "/create-word-document",
});

// A brand-new document written from a blank page. It is not a converter and does not open an
// uploaded file: see components/wordCreator.
export default function CreateWordDocumentPage() {
  return (
    <PageShell width="workspace" ads="workflow">
      <JsonLd
        data={graph(
          webApplicationSchema("/create-word-document", landing.appName, landing.description, landing.features),
          webPageSchema("/create-word-document", landing.h1, landing.description),
          breadcrumbSchema("/create-word-document", [{ name: "Tools", path: "/tools" }, ...landing.crumbs]),
        )}
      />
      <div className="space-y-4">
        <nav aria-label="Breadcrumb" className="text-sm text-zinc-500 dark:text-zinc-400">
          <Link href="/tools" className="inline-flex min-h-11 min-w-11 items-center justify-center hover:underline">
            Tools
          </Link>
          <span aria-hidden> / </span>
          <span>Create Word Document</span>
        </nav>
        <div>
          <h1 className="page-title">{landing.h1}</h1>
          <p className="muted mt-1 text-sm">{landing.intro}</p>
        </div>
        <WordCreatorLoader />
      </div>
      <SeoContent page={landing} />
    </PageShell>
  );
}
