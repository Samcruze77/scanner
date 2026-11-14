// What a search engine is served: fetches every URL in the sitemap (no JavaScript, as the first crawl pass
// sees it) and reports the title, description, canonical, robots tag, H1, word count, structured data types
// and internal links, then flags problems (missing or duplicate titles and descriptions, lengths that get
// cut in results, canonical mismatches, thin pages, pages nothing links to).
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
  const ld = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => {
    try {
      const data = JSON.parse(m[1]);
      return (Array.isArray(data) ? data : data["@graph"] ?? [data]).map((d) => d["@type"]);
    } catch {
      return ["INVALID"];
    }
  });
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
}

if (JSON_OUT) console.log(JSON.stringify(pages.map(({ links, ...rest }) => ({ ...rest, inbound: inbound.get(rest.path) })), null, 1));
else {
  for (const p of pages) console.log(`${p.path}\n   T(${p.title.length}) ${p.title}\n   D(${p.description?.length ?? 0}) ${p.description}\n   H1 ${p.h1.join(" | ")}  | ${p.words} words | in ${inbound.get(p.path)} | ld ${[...new Set(p.ld)].join(",")}`);
  console.log(`\n${pages.length} pages; ${problems.length} problem(s)`);
  for (const line of problems) console.log("  - " + line);
}
if (process.argv.includes("--strict") && problems.length) process.exit(1);
