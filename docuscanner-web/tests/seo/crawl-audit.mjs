// What a search engine is served: fetches every URL in the sitemap (no JavaScript, as the first crawl pass
// sees it) and reports the title, description, canonical, robots tag, H1, word count, structured data types
// and internal links, then flags problems (missing or duplicate titles and descriptions, lengths that get
// cut in results, canonical mismatches, thin pages, pages nothing links to, incomplete or dangling
// structured data, guide dates that differ from their Article data, sitemap lastmod that is missing or
// meaningless, broken internal links and redirect chains, robots.txt rules, private pages without
// noindex, and unknown URLs that do not answer 404).
//   node tests/seo/crawl-audit.mjs [baseUrl] [--json]
const BASE = (process.argv.find((a) => a.startsWith("http")) ?? "http://localhost:3000").replace(/\/+$/, "");
const JSON_OUT = process.argv.includes("--json");
const UA = "Mozilla/5.0 (compatible; seo-audit)";

const get = async (url) => {
  const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "manual" });
  return { status: res.status, location: res.headers.get("location"), robotsHeader: res.headers.get("x-robots-tag"), text: res.status === 200 ? await res.text() : "" };
};
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
const attr = (tag, name) => (tag.match(new RegExp(`${name}="([^"]*)"`, "i")) ?? [])[1];

const sitemap = await get(`${BASE}/sitemap.xml`);
const listed = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (listed.length === 0) throw new Error("the sitemap has no URLs");
const origin = new URL(listed[0]).origin;
const pages = [];
for (const loc of listed) {
  const path = new URL(loc).pathname;
  const res = await get(BASE + path);
  const html = res.text;
  const head = html.slice(0, html.indexOf("</head>") + 7);
  const metas = [...head.matchAll(/<meta[^>]+>/g)].map((m) => m[0]);
  const meta = (key) => {
    const tag = metas.find((t) => attr(t, "name") === key || attr(t, "property") === key);
    return tag ? decode(attr(tag, "content") ?? "") : null;
  };
  const canonicalTag = (head.match(/<link[^>]+rel="canonical"[^>]*>/) ?? [])[0];
  const body = html.slice(html.indexOf("<body")).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ");
  const main = (body.match(/<main[\s\S]*<\/main>/) ?? [body])[0];
  const text = decode(main.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  const h1 = [...body.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => decode(m[1].replace(/<[^>]+>/g, "")).trim());
  const ldNodes = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => {
    try {
      const data = JSON.parse(m[1]);
      return Array.isArray(data) ? data : data["@graph"] ?? [data];
    } catch {
      return [{ "@type": "INVALID" }];
    }
  });
  const ld = ldNodes.map((d) => d["@type"]);
  const timeTag = (body.match(/<time[^>]+dateTime="([^"]+)"/i) ?? [])[1] ?? null;
  const links = [...new Set([...body.matchAll(/<a[^>]+href="(\/[^"#?]*)/g)].map((m) => (m[1].length > 1 ? m[1].replace(/\/$/, "") : m[1])))];
  pages.push({
    path,
    status: res.status,
    location: res.location,
    title: decode((head.match(/<title>([^<]*)<\/title>/) ?? [])[1] ?? ""),
    description: meta("description"),
    canonical: canonicalTag ? attr(canonicalTag, "href") : null,
    robots: meta("robots") ?? res.robotsHeader,
    ogImage: meta("og:image"),
    ogTitle: meta("og:title"),
    h1,
    words: text ? text.split(" ").length : 0,
    ld,
    ldNodes,
    timeTag,
    links,
  });
}

const inbound = new Map(pages.map((p) => [p.path, 0]));
for (const p of pages) for (const l of p.links) if (l !== p.path && inbound.has(l)) inbound.set(l, inbound.get(l) + 1);
const count = (key) => {
  const seen = new Map();
  for (const p of pages) seen.set(p[key], (seen.get(p[key]) ?? 0) + 1);
  return seen;
};
const titles = count("title");
const descriptions = count("description");
const problems = [];
for (const p of pages) {
  const flag = (msg) => problems.push(`${p.path}: ${msg}`);
  if (p.status !== 200) flag(`status ${p.status}${p.location ? ` -> ${p.location}` : ""}`);
  if (!p.title) flag("no title");
  else {
    if (titles.get(p.title) > 1) flag(`title shared with ${titles.get(p.title) - 1} other page(s)`);
    if (p.title.length > 62) flag(`title is ${p.title.length} characters (cut in results after about 60)`);
    if (p.title.length < 25) flag(`title is only ${p.title.length} characters`);
  }
  if (!p.description) flag("no description");
  else {
    if (descriptions.get(p.description) > 1) flag(`description shared with ${descriptions.get(p.description) - 1} other page(s)`);
    if (p.description.length > 162) flag(`description is ${p.description.length} characters (cut after about 160)`);
    if (p.description.length < 70) flag(`description is only ${p.description.length} characters`);
  }
  const expected = origin + (p.path === "/" ? "" : p.path);
  if (!p.canonical) flag("no canonical");
  else if (p.canonical.replace(/\/$/, "") !== expected.replace(/\/$/, "")) flag(`canonical is ${p.canonical}`);
  if (p.robots && /noindex/i.test(p.robots)) flag(`listed in the sitemap but ${p.robots}`);
  if (p.h1.length !== 1) flag(`${p.h1.length} H1 headings`);
  if (p.words < 220) flag(`only ${p.words} words of content in the HTML`);
  if (!p.ogImage) flag("no og:image");
  if (p.ld.length === 0 && p.path !== "/privacy") flag("no structured data");
  if (p.ld.includes("INVALID")) flag("structured data does not parse");
  if (p.path !== "/" && inbound.get(p.path) < 2) flag(`linked from only ${inbound.get(p.path)} other sitemap page(s)`);
  // Structured data: every @id reference resolves inside the page, and each type has what
  // Google needs (and nothing invented: no ratings or reviews anywhere).
  const ids = new Set(p.ldNodes.map((n) => n["@id"]).filter(Boolean));
  const refs = JSON.stringify(p.ldNodes).match(/\{"@id":"[^"]+"\}/g) ?? [];
  for (const ref of refs) {
    const id = JSON.parse(ref)["@id"];
    if (!ids.has(id) && !id.endsWith("/#organization") && !id.endsWith("/#website")) flag(`structured data refers to missing ${id}`);
  }
  if (/aggregateRating|"review"/i.test(JSON.stringify(p.ldNodes))) flag("structured data has ratings or reviews");
  for (const n of p.ldNodes) {
    const t = n["@type"];
    if (t === "Article") {
      for (const k of ["headline", "datePublished", "dateModified", "image", "author", "publisher"]) if (!n[k]) flag(`Article has no ${k}`);
      if (n.headline?.length > 110) flag("Article headline over 110 characters");
      if (n.dateModified < n.datePublished) flag("Article modified before it was published");
      if (p.timeTag !== n.dateModified) flag(`visible date ${p.timeTag} does not match dateModified ${n.dateModified}`);
    }
    if (t === "BreadcrumbList") {
      n.itemListElement.forEach((item, i) => {
        if (item.position !== i + 1 || !item.name || !item.item) flag(`breadcrumb item ${i + 1} is incomplete`);
      });
    }
    if (t === "WebApplication" && (!n.name || n.offers?.price !== "0" || !n.applicationCategory)) flag("WebApplication is missing name, free offer or category");
    if (t === "Organization" && !n.logo?.url) flag("Organization has no logo");
  }
}

// The sitemap's <lastmod>: present, a real date, not in the future, and not all the same
// (a date that is always "now" tells search engines nothing and gets ignored).
const lastmods = [...sitemap.text.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
if (lastmods.length !== listed.length) problems.push(`sitemap: ${listed.length - lastmods.length} URL(s) without lastmod`);
const today = new Date().toISOString().slice(0, 10);
for (const d of new Set(lastmods)) if (Number.isNaN(Date.parse(d)) || d.slice(0, 10) > today) problems.push(`sitemap: bad lastmod ${d}`);
if (lastmods.length > 5 && new Set(lastmods).size === 1) problems.push("sitemap: every lastmod is the same date");

// Every internal link on every sitemap page (including the footer and the near-duplicate tool
// pages that are not in the sitemap) must answer 200, or redirect once straight to a 200.
const linked = new Set(pages.flatMap((p) => p.links));
for (const link of linked) {
  const first = await get(BASE + link);
  if (first.status === 200) continue;
  if (first.status >= 300 && first.status < 400 && first.location) {
    const second = await get(new URL(first.location, BASE + link).href.replace(origin, BASE));
    if (second.status !== 200) problems.push(`link ${link}: redirect chain or broken target (${first.status} -> ${first.location} -> ${second.status})`);
  } else problems.push(`link ${link}: status ${first.status}`);
}

// robots.txt keeps private and machine-only areas out without blocking pages or assets, and
// the private pages themselves say noindex (robots.txt alone would hide that tag).
const robots = await get(`${BASE}/robots.txt`);
if (!/Sitemap:\s*\S+\/sitemap\.xml/i.test(robots.text) && !/Disallow:\s*\/\s*$/m.test(robots.text)) problems.push("robots.txt: no Sitemap line");
for (const blocked of ["/admin", "/api/"]) if (!new RegExp(`Disallow:\\s*${blocked.replace(/\//g, "\\/")}\\s*$`, "m").test(robots.text) && !/Disallow:\s*\/\s*$/m.test(robots.text)) problems.push(`robots.txt: ${blocked} not disallowed`);
for (const path of listed.map((l) => new URL(l).pathname)) if (/^\/(admin|api)(\/|$)/.test(path)) problems.push(`robots.txt blocks sitemap page ${path}`);
for (const priv of ["/account", "/history", "/reset-password"]) {
  const res = await get(BASE + priv);
  const tag = (res.text.match(/<meta name="robots" content="([^"]*)"/) ?? [])[1] ?? res.robotsHeader ?? "";
  if (!/noindex/.test(tag)) problems.push(`${priv}: private page without noindex (${res.status})`);
  if (listed.some((l) => new URL(l).pathname === priv)) problems.push(`${priv}: private page listed in the sitemap`);
}
const missing = await get(`${BASE}/this-page-does-not-exist-seo-check`);
if (missing.status !== 404) problems.push(`unknown URL answers ${missing.status}, not 404`);

if (JSON_OUT) console.log(JSON.stringify(pages.map(({ links, ldNodes, ...rest }) => ({ ...rest, inbound: inbound.get(rest.path) })), null, 1));
else {
  for (const p of pages) console.log(`${p.path}\n   T(${p.title.length}) ${p.title}\n   D(${p.description?.length ?? 0}) ${p.description}\n   H1 ${p.h1.join(" | ")}  | ${p.words} words | in ${inbound.get(p.path)} | ld ${[...new Set(p.ld)].join(",")}`);
  console.log(`\n${pages.length} pages; ${problems.length} problem(s)`);
  for (const line of problems) console.log("  - " + line);
}
if (process.argv.includes("--strict") && problems.length) process.exit(1);
