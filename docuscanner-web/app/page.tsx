import type { Metadata } from "next";
import Link from "next/link";
import { AdBottom, AdTop } from "@/components/ads/AdSlot";
import { CONVERT_TOOLS } from "@/components/convert/tools";
import { HomeAuthCta } from "@/components/home/HomeAuthCta";
import { VisitCounter } from "@/components/home/VisitCounter";
import { JsonLd } from "@/components/seo/JsonLd";
import { Icon, type IconName } from "@/components/ui/icons";
import { SUPPORTED_FORMATS } from "@/utils/scanner/documentTypes";
import { RELATED, type RelatedLink } from "@/utils/seo/landing";
import { pageMetadata } from "@/utils/seo/metadata";
import { graph, organizationSchema, websiteSchema } from "@/utils/seo/schema";
import { SITE_NAME } from "@/utils/seo/site";

// Search intent for the home page: a free, online PDF scanner and converter, i.e. the hub
// that leads to every tool. The tool pages and guides each target their own, narrower
// queries (see docs/seo/README.md), so this page names the range rather than one task.
export const metadata: Metadata = pageMetadata({
  title: SITE_NAME,
  absoluteTitle: `Free PDF Scanner, Converter & Editor Online | ${SITE_NAME}`,
  description:
    "Scan documents to PDF with your phone or computer, convert PDF to Word or Excel, then compress, sign or extract text. Free, no sign-up, no watermark.",
  path: "/",
});

// The most-used single-task tools, linked by what they do. The home page is the site's
// strongest page, so these links are also how search engines find and value the tool pages.
const POPULAR: RelatedLink[] = [
  RELATED.compressPdf,
  RELATED.editor,
  RELATED.sign,
  RELATED.fillSign,
  RELATED.mergePdf,
  RELATED.protectPdf,
  RELATED.ocr,
  { ...RELATED.imageToPdf, href: "/jpg-to-pdf", label: "Convert JPG to PDF" },
  RELATED.deletePages,
  RELATED.rotatePdf,
  RELATED.editImage,
  RELATED.compressImage,
];

const GUIDE_LINKS: RelatedLink[] = [
  { href: "/guides/how-to-scan-a-document-to-pdf", label: "How to scan a document to PDF", note: "On a phone, a computer or with a flatbed scanner." },
  { href: "/guides/how-to-reduce-pdf-file-size", label: "How to reduce PDF file size", note: "Including scanned PDFs that are too big to email." },
  { href: "/guides/how-to-convert-pdf-to-word", label: "How to convert PDF to Word", note: "What converts well, what needs tidying, and scanned PDFs." },
  { href: "/guides/how-to-password-protect-a-pdf", label: "How to password protect a PDF", note: "Lock a PDF before you email it." },
];

// Each claim is true of every tool on the site (see utils/seo/landing.ts for the details).
const TRUST = [
  { icon: "shield" as const, title: "Your files stay on your device", body: "Files are processed in your browser and are not uploaded to our servers." },
  { icon: "check" as const, title: "Free, with no sign-up", body: "Every tool works without an account, and downloads carry no watermark. The site is supported by ads." },
  { icon: "camera" as const, title: "Phone or computer", body: "Works in any modern browser. Scan with your phone's camera, or upload from your computer." },
  { icon: "info" as const, title: "Honest limits", body: "Each tool lists the files it takes and what it cannot do, so you know before you start." },
];

// What people come here to do, in their words. Each goes straight to the place that
// does it. (Everything runs in the browser: files are never uploaded.)
const GOALS: { href: string; icon: IconName; title: string; body: string }[] = [
  {
    href: "/scan",
    icon: "camera",
    title: "Scan and make a PDF",
    body: "Capture pages with your camera or upload a file, tidy them up, and export one clean PDF.",
  },
  {
    href: "/tools",
    icon: "signature",
    title: "Sign and mark up",
    body: "Add your signature, text, dates, check marks and highlights to any document.",
  },
  {
    href: "/convert",
    icon: "convert",
    title: "Convert a file",
    body: "Word, Excel, PDF and pictures, converted in your browser.",
  },
  {
    href: "/tools/compress-pdf",
    icon: "compress",
    title: "Make a file smaller",
    body: "Shrink a PDF, photo, Word or Excel file with a quality-to-size slider.",
  },
  {
    href: "/create-word-document",
    icon: "document",
    title: "Create a Word document",
    body: "Write a new document on a blank page, format it, add pictures, and download a real .docx.",
  },
];

const STEPS = [
  { icon: "camera" as const, title: "Add pages", body: "Camera, or a PDF, Word, Excel, CSV or image." },
  { icon: "crop" as const, title: "Tidy up", body: "Crop, rotate, enhance, sign and reorder." },
  { icon: "download" as const, title: "Export", body: "Download, print or save your PDF." },
];

export default function Home() {
  return (
    <main id="main" className="flex-1">
      <JsonLd data={graph(organizationSchema(), websiteSchema())} />
      <section className="mx-auto w-full max-w-4xl px-4 pb-10 pt-12 text-center sm:px-6 sm:pt-20">
        <div className="mb-5 flex flex-wrap items-center justify-center gap-2">
          <p className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-surface px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
            <Icon name="shield" size={14} className="text-emerald-600 dark:text-emerald-400" />
            Your files stay on your device
          </p>
          <VisitCounter />
        </div>
        <h1 className="mx-auto max-w-2xl text-3xl font-semibold tracking-tight sm:text-5xl">
          Free PDF scanner and converter, right in your browser
        </h1>
        <p className="muted mx-auto mt-4 max-w-xl text-base sm:text-lg">
          Turn paper into a clean PDF with your camera, convert between PDF, Word, Excel and images, then compress, sign or
          extract the text. Free on phone or computer, with nothing to install.
        </p>

        <div className="mx-auto mt-8 flex max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
          <Link href="/scan?mode=camera" className="btn btn-primary btn-lg">
            <Icon name="camera" size={20} />
            Scan document
          </Link>
          <Link href="/scan?mode=upload" className="btn btn-secondary btn-lg">
            <Icon name="upload" size={20} />
            Upload document
          </Link>
        </div>
        <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">{SUPPORTED_FORMATS}. Free to use, supported by ads.</p>
      </section>

      <section aria-labelledby="goals-title" className="mx-auto w-full max-w-5xl px-4 pb-10 sm:px-6">
        <h2 id="goals-title" className="section-title mb-4">
          What would you like to do?
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {GOALS.map((goal, i) => (
            <li key={goal.href} className={i === GOALS.length - 1 && GOALS.length % 2 === 1 ? "sm:col-span-2" : undefined}>
              <Link
                href={goal.href}
                className="card group flex h-full items-start gap-4 p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/40 dark:hover:border-blue-800 dark:hover:bg-blue-950/30"
              >
                <span
                  aria-hidden
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400"
                >
                  <Icon name={goal.icon} size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2 text-base font-semibold">
                    {goal.title}
                    <Icon name="arrow-right" size={18} className="text-zinc-400 transition-colors group-hover:text-blue-600" />
                  </span>
                  <span className="muted mt-1 block text-sm">{goal.body}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="mx-auto w-full max-w-5xl px-4 pb-10 sm:px-6">
        <AdTop />
      </div>

      <section aria-labelledby="how-title" className="mx-auto w-full max-w-5xl px-4 pb-10 sm:px-6">
        <h2 id="how-title" className="section-title mb-4">
          How it works
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="card flex items-start gap-3 p-4">
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              >
                {index + 1}
              </span>
              <span>
                <span className="block text-sm font-semibold">{step.title}</span>
                <span className="muted mt-0.5 block text-sm">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="convert-title" className="mx-auto w-full max-w-5xl px-4 pb-10 sm:px-6">
        <h2 id="convert-title" className="section-title">
          Convert your files
        </h2>
        <p className="muted mb-4 mt-1 text-sm">It all happens in your browser, so your files are never uploaded.</p>
        <ul className="card divide-y divide-zinc-200 overflow-hidden dark:divide-zinc-800">
          {CONVERT_TOOLS.map((tool) => (
            <li key={tool.href}>
              <Link
                href={tool.href}
                className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{tool.title}</span>
                  <span className="muted block truncate text-sm">{tool.body}</span>
                </span>
                <Icon name="chevron-right" size={18} className="text-zinc-400" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="popular-title" className="mx-auto w-full max-w-5xl px-4 pb-10 sm:px-6">
        <h2 id="popular-title" className="section-title">
          Popular free PDF tools
        </h2>
        <p className="muted mb-4 mt-1 text-sm">
          One job each, no account needed. See{" "}
          <Link href="/tools" className="underline hover:no-underline">
            all PDF tools
          </Link>{" "}
          for the full list.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {POPULAR.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="card flex h-full min-h-14 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{link.label}</span>
                  <span className="muted block text-sm">{link.note}</span>
                </span>
                <Icon name="chevron-right" size={18} className="shrink-0 text-zinc-400" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="why-title" className="mx-auto w-full max-w-5xl px-4 pb-10 sm:px-6">
        <h2 id="why-title" className="section-title mb-4">
          Why use FreePDFScanner
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {TRUST.map((item) => (
            <li key={item.title} className="card flex items-start gap-3 p-4">
              <Icon name={item.icon} size={20} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>
                <span className="block text-sm font-semibold">{item.title}</span>
                <span className="muted mt-0.5 block text-sm">{item.body}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="muted mt-3 text-sm">
          Want to check the privacy claim yourself?{" "}
          <Link href="/guides/how-to-check-a-pdf-site-does-not-upload-your-file" className="underline hover:no-underline">
            How to check whether a PDF website uploads your file
          </Link>
          .
        </p>
      </section>

      <section aria-labelledby="guides-title" className="mx-auto w-full max-w-5xl px-4 pb-10 sm:px-6">
        <h2 id="guides-title" className="section-title">
          Guides
        </h2>
        <p className="muted mb-4 mt-1 text-sm">
          Step-by-step answers to common document questions.{" "}
          <Link href="/guides" className="underline hover:no-underline">
            All guides
          </Link>
        </p>
        <ul className="card divide-y divide-zinc-200 overflow-hidden dark:divide-zinc-800">
          {GUIDE_LINKS.map((guide) => (
            <li key={guide.href}>
              <Link
                href={guide.href}
                className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{guide.label}</span>
                  <span className="muted block text-sm">{guide.note}</span>
                </span>
                <Icon name="chevron-right" size={18} className="shrink-0 text-zinc-400" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 pb-8 sm:px-6">
        <HomeAuthCta />
      </section>

      <div className="mx-auto w-full max-w-5xl px-4 pb-10 sm:px-6">
        <AdBottom />
      </div>
    </main>
  );
}
