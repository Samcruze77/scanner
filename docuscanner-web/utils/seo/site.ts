// The one place that knows the site's name and public address.
//
// The address (used for canonical URLs, the sitemap, Open Graph and structured data)
// is never hard-coded. It comes from, in order:
//   1. NEXT_PUBLIC_SITE_URL          -- set this to the final custom domain (e.g.
//                                       https://www.example.com) when it is connected;
//   2. VERCEL_PROJECT_PRODUCTION_URL -- Vercel's own production hostname for this project;
//   3. VERCEL_URL                    -- this deployment's hostname (previews);
//   4. http://localhost:3000         -- local development and local production builds.
// So switching to a custom domain is one environment variable, not a code change.

export const SITE_NAME = "PDFScanner";

// Used as the default description and in structured data.
export const SITE_DESCRIPTION =
  "Free online PDF scanner and document tools: scan documents to PDF, edit and sign PDFs, extract text with OCR, compress and convert files, right in your browser.";

function withProtocol(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const candidate =
    (explicit && withProtocol(explicit)) ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL && withProtocol(process.env.VERCEL_PROJECT_PRODUCTION_URL)) ||
    (process.env.VERCEL_URL && withProtocol(process.env.VERCEL_URL)) ||
    "http://localhost:3000";
  return candidate.replace(/\/+$/, "");
}

// Search engines should only index the real production site. Vercel preview and
// development deployments (and anything else that is not production) are kept out.
// Outside Vercel (local builds) the normal rules apply so they can be inspected.
export function isIndexableDeployment(): boolean {
  const env = process.env.VERCEL_ENV;
  return env === undefined || env === "production";
}

// An absolute URL for a site path such as "/scan". The home page keeps its slash.
export function absoluteUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${getSiteUrl()}${clean}`;
}
