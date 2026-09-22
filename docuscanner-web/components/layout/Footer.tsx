// Site footer: links to every main tool, converter and guide from every page, so people
// (and crawlers) can always reach them, and one honest line about how the site works.

import Link from "next/link";
import { GUIDES } from "@/utils/seo/guides";
import { SITE_NAME } from "@/utils/seo/site";

const TOOLS = [
  { href: "/scan", label: "Scan to PDF" },
  { href: "/tools/pdf-editor", label: "Edit PDF" },
  { href: "/tools/sign-pdf", label: "Sign PDF" },
  { href: "/tools/annotate", label: "Annotate PDF" },
  { href: "/tools/ocr", label: "OCR: extract text" },
  { href: "/tools/compress-pdf", label: "Compress PDF" },
  { href: "/tools/compress-image", label: "Compress image" },
];

const CONVERT = [
  { href: "/convert/image-to-pdf", label: "Image to PDF" },
  { href: "/convert/word-to-pdf", label: "Word to PDF" },
  { href: "/convert/pdf-to-word", label: "PDF to Word" },
  { href: "/convert/excel-to-pdf", label: "Excel to PDF" },
  { href: "/convert/pdf-to-excel", label: "PDF to Excel" },
];

const linkClass = "inline-flex min-h-11 items-center text-sm hover:underline";

function Column({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <h2 className="panel-title mb-1">{title}</h2>
      <ul>
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className={linkClass}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="mt-auto border-t border-line bg-chrome">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <p className="text-base font-semibold">{SITE_NAME}</p>
            <p className="muted mt-2 max-w-xs text-sm leading-6">
              Free online PDF scanner and document tools. Your files are processed in your browser and are not uploaded.
            </p>
          </div>
          <Column title="Tools" links={TOOLS} />
          <Column title="Convert" links={CONVERT} />
          <Column
            title="Guides"
            links={[{ href: "/guides", label: "All guides" }, ...GUIDES.slice(0, 4).map((g) => ({ href: `/guides/${g.slug}`, label: g.h1.replace(/^How to /, "How to ") }))]}
          />
        </div>
        <p className="muted mt-8 text-xs">
          &copy; {new Date().getFullYear()} {SITE_NAME}. Free to use and supported by ads.
        </p>
      </div>
    </footer>
  );
}
