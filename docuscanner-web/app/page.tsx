import Link from "next/link";
import { AdSlot } from "@/components/ads/AdSlot";
import { CONVERT_TOOLS } from "@/components/convert/tools";
import { HomeAuthCta } from "@/components/home/HomeAuthCta";
import { SUPPORTED_FORMATS } from "@/utils/scanner/documentTypes";

const FEATURES = [
  {
    title: "Scan with your camera",
    body: "Capture pages with your phone or laptop camera, right in the browser.",
  },
  {
    title: "Edit, sign and reorder",
    body: "Crop, enhance and reorder pages, add text and your signature, and bring in PDF, Word, Excel or CSV files too.",
  },
  {
    title: "Free, no account required",
    body: "Scan and download as a guest. Sign in only if you want to save documents.",
  },
];

export default function Home() {
  return (
    <main className="flex-1">
      <section className="mx-auto w-full max-w-5xl px-4 pb-10 pt-14 text-center sm:pt-20">
        <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-500 dark:border-zinc-800">
          Free while in early access
        </span>
        <h1 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl">
          Turn any document into a clean PDF, in seconds
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-zinc-600 dark:text-zinc-400 sm:text-lg">
          DocuScanner scans, organizes, and exports documents right in your browser. Free to use,
          on desktop or mobile, no download required.
        </p>

        <div className="mx-auto mt-8 flex max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
          <Link
            href="/scan?mode=camera"
            className="min-h-12 rounded-md bg-zinc-900 px-6 py-3 text-base font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            Scan document
          </Link>
          <Link
            href="/scan?mode=upload"
            className="min-h-12 rounded-md border border-zinc-300 px-6 py-3 text-base font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Upload document
          </Link>
        </div>

        <p className="mt-4 text-sm text-zinc-500">{SUPPORTED_FORMATS}</p>
        <p className="mt-1 text-sm text-zinc-500">Free to use. Supported by ads.</p>
      </section>

      <div className="mx-auto w-full max-w-5xl space-y-3 px-4">
        <AdSlot variant="top-banner" />
        <AdSlot variant="mobile-banner" />
      </div>

      <section className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-14 sm:grid-cols-3">
        {FEATURES.map((feature) => (
          <div key={feature.title} className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
            <h2 className="font-semibold">{feature.title}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{feature.body}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 pb-14">
        <h2 className="mb-1 text-xl font-semibold">Convert your files</h2>
        <p className="mb-5 text-sm text-zinc-600 dark:text-zinc-400">
          Free, and it all happens in your browser, so your files are never uploaded.
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          {CONVERT_TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className="rounded-lg border border-zinc-200 p-5 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              <h3 className="font-semibold">{tool.title}</h3>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{tool.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 pb-16 text-center">
        <HomeAuthCta />
      </section>
    </main>
  );
}
