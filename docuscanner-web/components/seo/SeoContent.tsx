// The explanation under a tool: what it does, how it works, supported files and honest
// limits, what happens to the person's document, common questions and where to go next.
// It is ordinary visible text rendered on the server, so it is in the page's HTML for
// people, screen readers and search engines alike. Nothing is hidden or collapsed.

import Link from "next/link";
import { Icon } from "@/components/ui/icons";
import type { LandingPage } from "@/utils/seo/landing";

export function SeoContent({ page }: { page: LandingPage }) {
  return (
    <section aria-label={`About ${page.h1}`} className="mt-12 max-w-3xl space-y-10 border-t border-line pt-10">
      <div>
        <h2 className="section-title">How it works</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6">
          {page.how.map((step) => (
            <li key={step} className="pl-1">
              {step}
            </li>
          ))}
        </ol>
      </div>

      <div>
        <h2 className="section-title">What it is good for</h2>
        <p className="muted mt-3 text-sm leading-6">{page.goodFor}</p>
      </div>

      <div>
        <h2 className="section-title">Supported files and limits</h2>
        <p className="muted mt-3 text-sm leading-6">
          <strong className="font-semibold text-fg">Files: </strong>
          {page.formats}
        </p>
        <ul className="muted mt-3 list-disc space-y-2 pl-5 text-sm leading-6">
          {page.limits.map((limit) => (
            <li key={limit} className="pl-1">
              {limit}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h2 className="section-title">Your files and privacy</h2>
        <p className="muted mt-3 text-sm leading-6">{page.privacy}</p>
      </div>

      <div>
        <h2 className="section-title">Questions and answers</h2>
        <dl className="mt-3 space-y-5">
          {page.faq.map((item) => (
            <div key={item.q}>
              <dt className="text-sm font-semibold">{item.q}</dt>
              <dd className="muted mt-1 text-sm leading-6">{item.a}</dd>
            </div>
          ))}
        </dl>
      </div>

      <RelatedTools links={page.related} heading="More PDF tools" />
    </section>
  );
}

// A short list of where to go next, with links that say where they lead.
export function RelatedTools({ links, heading }: { links: { href: string; label: string; note: string }[]; heading: string }) {
  return (
    <div>
      <h2 className="section-title">{heading}</h2>
      <ul className="card mt-3 divide-y divide-line overflow-hidden">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-hover">
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{link.label}</span>
                <span className="muted block text-sm">{link.note}</span>
              </span>
              <Icon name="chevron-right" size={18} className="text-zinc-400" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
