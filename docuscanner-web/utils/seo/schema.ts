// Structured data (schema.org JSON-LD), limited to what is true of PDFScanner.
//
//  - Organization, WebSite: the site itself (home page).
//  - WebApplication: each tool page. Free, with an Offer priced 0. It carries NO ratings,
//    reviews, download counts, awards or prices other than "free", because none exist.
//  - BreadcrumbList: the visible breadcrumb trail.
//  - WebPage: ties a page to the site and its breadcrumb.
//  - Article: the how-to guides.
// FAQPage is deliberately not used: Google no longer shows FAQ rich results for a site
// like this, and the FAQ text is already visible on the page.

import type { Crumb } from "./landing";
import { HOME_CRUMB } from "./landing";
import { absoluteUrl, getSiteUrl, SITE_DESCRIPTION, SITE_NAME } from "./site";

type Json = Record<string, unknown>;

const ORG_ID = () => `${getSiteUrl()}/#organization`;
const SITE_ID = () => `${getSiteUrl()}/#website`;

export function organizationSchema(): Json {
  return {
    "@type": "Organization",
    "@id": ORG_ID(),
    name: SITE_NAME,
    url: `${getSiteUrl()}/`,
    logo: { "@type": "ImageObject", url: absoluteUrl("/icon"), width: 512, height: 512 },
  };
}

export function websiteSchema(): Json {
  return {
    "@type": "WebSite",
    "@id": SITE_ID(),
    url: `${getSiteUrl()}/`,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    inLanguage: "en",
    publisher: { "@id": ORG_ID() },
  };
}

export function breadcrumbSchema(path: string, crumbs: Crumb[]): Json {
  const trail = [HOME_CRUMB, ...crumbs];
  return {
    "@type": "BreadcrumbList",
    "@id": `${absoluteUrl(path)}#breadcrumb`,
    itemListElement: trail.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      // Google reads the last item's URL from the page itself, but a full trail is valid.
      item: absoluteUrl(c.path),
    })),
  };
}

export function webPageSchema(path: string, name: string, description: string, hasBreadcrumb = true): Json {
  return {
    "@type": "WebPage",
    "@id": `${absoluteUrl(path)}#webpage`,
    url: absoluteUrl(path),
    name,
    description,
    inLanguage: "en",
    isPartOf: { "@id": SITE_ID() },
    ...(hasBreadcrumb ? { breadcrumb: { "@id": `${absoluteUrl(path)}#breadcrumb` } } : {}),
  };
}

export function webApplicationSchema(path: string, name: string, description: string, features: string[]): Json {
  return {
    "@type": "WebApplication",
    "@id": `${absoluteUrl(path)}#app`,
    name,
    url: absoluteUrl(path),
    description,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript and a modern web browser",
    isAccessibleForFree: true,
    inLanguage: "en",
    featureList: features,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@id": ORG_ID() },
  };
}

export function articleSchema(path: string, headline: string, description: string, published: string, updated: string): Json {
  return {
    "@type": "Article",
    "@id": `${absoluteUrl(path)}#article`,
    headline,
    description,
    datePublished: published,
    dateModified: updated,
    inLanguage: "en",
    mainEntityOfPage: { "@id": `${absoluteUrl(path)}#webpage` },
    image: absoluteUrl("/og"),
    author: { "@id": ORG_ID() },
    publisher: { "@id": ORG_ID() },
  };
}

// One <script> per page, as a @graph so the parts can refer to each other by @id.
export function graph(...nodes: Json[]): Json {
  return { "@context": "https://schema.org", "@graph": nodes };
}
