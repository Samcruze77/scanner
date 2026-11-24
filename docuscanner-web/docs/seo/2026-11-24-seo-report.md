# FreePDFScanner SEO review and improvements: 2026-11-24

Scope: the public website https://www.freepdfscanner.com (Next.js app `docuscanner-web`, branch
`web-only`). All changes are in the working tree, **uncommitted and not deployed**. Rules for future
pages and the keyword map are in [README.md](README.md).

Data sources, and how far they can be trusted:

- **Verified**: Google Search Console (domain property) and Bing Webmaster Tools, read on 2026-11-24
  in the owner's browser, read-only. Local crawl of the production build. Lab performance measured
  in Chrome on the local build.
- **Not available**: search volumes, keyword difficulty, backlink data (no paid SEO tools were used),
  PageSpeed Insights (Google's anonymous daily quota was exhausted when tried), field Core Web Vitals
  (Search Console: "not enough usage data" for mobile and desktop).
- Anything not marked as verified is a judgement of search intent, not a measurement.

---

## A. Initial assessment

### Verified search position (before these changes)

**Google, last 3 months (to 2026-11-22):** 822 impressions, 4 clicks, CTR 0.5%, average position
71.3, 192 queries, 26 pages with impressions.

| Page | Impressions | Clicks |
|---|---|---|
| /guides/how-to-scan-a-document-to-pdf | 275 | 0 |
| /guides/how-to-reduce-pdf-file-size | 98 | 0 |
| /guides/how-to-extract-text-from-a-scanned-pdf | 98 | 0 |
| /scan | 84 | 1 |
| /guides/ilovepdf-alternatives-compared | 83 | 0 |
| /create-word-document | 51 | 1 |
| / | 36 | 1 |

Top Google queries by impressions: "ilovepdf alternative" (50), "how to scan a document as pdf" (47),
"how to make a scanned pdf smaller" (47), "how to make scanned documents smaller file size" (32),
"how can i scan to pdf" (30). Google mostly shows the site for **how-to** questions, at positions
around 70, where nobody clicks.

**Google indexing (report dated 2026-11-16):** 31 indexed, 30 not indexed. Of those, 24 are
"Discovered - currently not indexed" with no crawl date at all, and they include most of the
money pages: /convert, /convert/excel-to-pdf, /convert/pdf-to-excel, /convert/word-to-pdf,
/tools/compress-pdf, /tools/protect-pdf, /tools/sign-pdf, /tools/pdf-editor, /tools/edit-image,
/tools/add-image, /tools/compress-excel, /merge-pdf, /edit-pdf, /fill-and-sign-pdf, /jpg-to-pdf,
/png-to-pdf, /scan-to-pdf, /pdf-converter, /document-converter, /pdf-to-text, /crop-pdf,
/delete-pdf-pages, /rotate-pdf and the Word-document guide. The other 6 are expected (3 redirects,
1 noindex page, 1 alternate with canonical, 1 crawled-not-indexed). Sitemap: submitted 2026-11-14,
read 2026-11-19, status Success, 49 URLs.

**Bing, last 7 days (2026-11-16 to 22):** 4.3K impressions, 111 clicks, CTR 2.57%. Bing ranks the
site far better than Google: "pdf scanner" 453 impressions at position 4.6 (21 clicks), "scan to pdf"
359 impressions at 7.4 (0 clicks), "free pdf scanner" position 2.2. Pages: /scan 2.6K impressions,
57 clicks, position 6.8; home 1.6K impressions, 54 clicks, position 6.4.

### Strengths (already in place)

- Clean technical base: every public page has a unique title and description, a self-referencing
  canonical, Open Graph/Twitter cards with a branded image, one H1, server-rendered content, and
  structured data (Organization, WebSite, WebApplication, WebPage, BreadcrumbList, Article).
- Apex and http redirect to `https://www.` (308); trailing slashes redirect; unknown URLs answer 404;
  preview deployments are noindexed and blocked; private pages (/account, /history, /reset-password)
  are noindex; short alias URLs (/pdf-to-word, /compress-pdf, /protect-pdf ...) are single 308s.
- Honest, specific content on every tool page (steps, supported files, real limits, privacy, FAQ).
- An existing crawl test (46 pages, 0 problems before this work).

### Weaknesses and critical issues found

1. **Sitemap `lastmod` was always "now"** (`new Date()` on every request), so every URL claimed to
   change on every crawl. Search engines learn to ignore such dates, removing a recrawl signal at the
   moment 24 pages were waiting to be crawled.
2. **Core Web Vitals problems on every page** (lab, mobile profile):
   - The cookie-consent banner was rendered only after JavaScript ran and, being the largest text
     block, became the **Largest Contentful Paint at 2.7-3.8 s** on every page for first-time
     visitors (the hero painted at about 1.1 s).
   - **Layout shift on every tool page:** CLS 0.14-0.34 at phone width (0.06-0.14 desktop) because
     tools loaded into a one-line "Loading…" placeholder and first-use tips appeared after hydration.
     /create-word-document: CLS 0.35 (phone) and 0.27 (desktop). Google's "good" limit is 0.1.
3. **Guides showed no date**, although their Article structured data carried one (Google compares
   them), and their text had no in-sentence links to the tools.
4. **Guides did not answer the queries they were shown for.** The scan guide (275 impressions) only
   described this site's tool, while searchers asking "how can I scan to PDF" often have an iPhone,
   an Android phone or a flatbed scanner in hand. The file-size guide said little about scanned PDFs
   although that was its main query.
5. **The home page linked to only 5 tools directly**, while most tool pages were never crawled.
6. `/api/` was crawlable (JSON endpoints only).
7. Minor: `/index` returns the homepage with a canonical to `/` (correct, left alone: Vercel's ISR
   regeneration renders the homepage under that path, and a redirect could interfere with it).
8. Content gaps: no guide for PDF to Word, password-protecting a PDF, or Excel to PDF, the most
   common how-to questions for tools the site has.
9. Products named in the brief that **do not exist** and so must not be targeted: PDF to JPG, PDF to
   PNG, PDF to PowerPoint, PowerPoint to PDF. "Image converter" exists only partly (Edit Image saves
   JPEG, PNG or WebP).

---

## B. Keyword strategy

The full keyword-to-page map (with intent and which queries are verified in Search Console or Bing)
is in [README.md](README.md#keyword-to-page-map-avoid-cannibalisation). Summary:

- **Hub and brand** ("free pdf scanner", "pdf scanner online free"): the home page. Bing already ranks
  it at 4-7. Title now leads with "Free PDF Scanner, Converter & Editor Online".
- **Scan to PDF** ("scan to pdf", "scan pdf online"): `/scan` (Bing 2.6K impressions/week). Phone-specific
  queries: `/scan-to-pdf`. "How to scan…" questions: the scan guide.
- **Converters**: one owner page each (`/convert/pdf-to-word`, `/convert/word-to-pdf`, `/jpg-to-pdf`,
  `/png-to-pdf`, `/convert/image-to-pdf`, `/convert/pdf-to-excel`, `/convert/excel-to-pdf`), generic
  "free pdf converter" to `/pdf-converter`, "online document converter" to `/document-converter`.
- **Tools**: compress (`/tools/compress-pdf`), protect (`/tools/protect-pdf` and the Office variants),
  OCR (`/tools/ocr`, `/image-to-text`, `/pdf-to-text`), sign, edit, merge, image edit/compress.
- **Informational / long-tail** (where Google already shows the site): "how to scan a document to pdf",
  "how to make a scanned pdf smaller", "compress pdf to 1mb/2mb", "extract text from scanned pdf",
  "how to convert pdf to word", "how to password protect a pdf", "how to convert excel to pdf
  without cutting off columns", "ilovepdf alternative". Each has exactly one guide.
- **Cannibalisation watch-list**: `/tools/pdf-editor` vs `/edit-pdf` (distinct titles, both not yet
  crawled by Google); home vs `/pdf-converter` for "free pdf converter" (home is the hub; the converter
  page owns the query). Check in Search Console which URL Google chooses for each query once indexed.
- **Content opportunities** (future, real features only): see section F.

---

## C. Implemented improvements

All in `docuscanner-web/`. No new dependencies.

### Technical SEO

| Change | Files |
|---|---|
| Sitemap `lastmod` = date the content really changed (guides use their `updated` date; others a maintained map with a baseline), never request time; `changefreq` dropped (ignored by Google) | `app/sitemap.ts`, new `utils/seo/updated.ts` |
| robots.txt also disallows `/api/` (JSON only; no page needs it to render) | `app/robots.ts` |

### Core Web Vitals (also affects real visitors)

| Change | Files |
|---|---|
| Consent banner is now in the server HTML, so it paints with the page instead of becoming a late LCP. A pre-paint head script (same pattern as the theme script) marks visitors who have already chosen, and CSS hides the banner for them before the first frame. Consent semantics are unchanged: nothing non-essential runs before a choice (end-to-end consent test 35/35). | `components/consent/ConsentBanner.tsx`, `utils/consent/consent.ts` (`CONSENT_INIT_SCRIPT`), `app/layout.tsx`, `app/globals.css` |
| First-use tips are server-rendered; tips already dismissed on this device are hidden before the first paint by an injected style rule. | `components/guidance/Hint.tsx`, new `components/guidance/hintStorage.ts`, `app/layout.tsx` |
| Tool placeholders reserve the measured height of each tool's empty state (scanner editor, compressors, image editor, protect, Word creator). | `components/tools/ToolWorkspace.tsx`, `components/wordCreator/WordCreatorLoader.tsx` |

### Metadata and on-page

| Page | Before | After |
|---|---|---|
| `/` title | FreePDFScanner: Free Online PDF Scanner, Editor & Converter | Free PDF Scanner, Converter & Editor Online \| FreePDFScanner |
| `/` description | generic site description | Scan documents to PDF with your phone or computer, convert PDF to Word or Excel, then compress, sign or extract text. Free, no sign-up, no watermark. |
| `/` H1 | Free PDF scanner: turn any document into a clean PDF in seconds | Free PDF scanner and converter, right in your browser |
| `/scan` title | Scan to PDF Online: Free Document Scanner | Scan to PDF Online: Free PDF Scanner (Bing's two top queries) |
| `/scan` description | … Free, private, in your browser. | mentions phone camera, automatic straightening, "Free, no sign-up" |
| scan guide title | How to Scan a Document to PDF (Phone or Computer) | How to Scan a Document to PDF on a Phone or Computer |
| file-size guide title | How to Reduce PDF File Size Without Ruining Quality | How to Reduce PDF File Size, Including Scanned PDFs |
| `/guides` description | scanning, compressing, converting and signing | adds password-protecting |

Home page content added: an intro naming the real range of tools; **"Popular free PDF tools"** (12
descriptive links straight to the tool pages Google had not crawled); **"Why use FreePDFScanner"**
(four claims that are true of every tool, with a link to the guide that shows how to verify the
privacy claim); **"Guides"** (4 links). In all, 19 new in-content links (12 tools, 5 guides, 2 hubs)
on the site's strongest page.

### Content

- **Scan guide** rewritten around the real query: new "Other ways to scan to PDF" section (iPhone/iPad
  Files and Notes, Android Google Drive, Windows Scan with a flatbed scanner, Mac Image Capture/Preview),
  plus in-text links. 606 → 843 words. Updated date 2026-11-24.
- **File-size guide**: new section "How to make a scanned PDF smaller" (why scans are big, stronger
  compression costs nothing for a scan, grayscale/black & white, 150-300 dpi, cropping, target size).
  498 → 709 words.
- **Three new guides**, each checked against the tool's code (limits, button names, behaviour):
  - `/guides/how-to-convert-pdf-to-word` (648 words): check whether the PDF is digital or scanned,
    steps, what converts well and what does not (pictures are not copied, columns need tidying,
    password-protected PDFs unsupported), scanned PDFs (English OCR), fixes, going back to PDF.
  - `/guides/how-to-password-protect-a-pdf` (520 words): steps, AES-256, what print/copy/edit limits
    really do, sharing the password safely, order of operations. The Office sentence follows the
    `protect.docx` feature flag so it is never wrong.
  - `/guides/how-to-convert-excel-to-pdf` (512 words): steps, how wide sheets are scaled to 55% then
    split into column groups, landscape (+41% width on A4), hidden rows/columns/sheets are skipped,
    what carries over and what does not.
- Guides now show a visible **Published/Updated date** that matches the Article structured data, and
  support in-sentence links written `[anchor](/path)` (`components/seo/InlineText.tsx`).

### Internal linking

- Tool pages link to their guide: `/tools/protect-pdf` → protect guide, `/convert/pdf-to-word` → PDF to
  Word guide, `/convert/excel-to-pdf` → Excel guide, `/tools/compress-pdf` → scanned-PDF section,
  `/scan` → scan guide (`utils/seo/landing.ts`).
- Guides link into tools and other guides from inside their text (scan guide 7 links, file-size guide
  4, new guides 5-8 each).
- Every sitemap page is now linked from 48 others (was 45; footer lists all guides).

### Structured data

Kept the existing, accurate set (no ratings, reviews, prices other than "free", or invented business
details). FAQPage and HowTo are deliberately not used (Google no longer shows those rich results for
sites like this). Added automated validation (below). New guides get Article + WebPage +
BreadcrumbList automatically.

### Tests and guidance

- `tests/seo/crawl-audit.mjs` (`npm run test:seo`) now also checks: dangling structured-data `@id`
  references, required Article/BreadcrumbList/WebApplication/Organization fields, no ratings/reviews,
  visible guide date = `dateModified`, sitemap lastmod present/valid/not-future/not-all-identical,
  every internal link answers 200 or one redirect to 200 (no chains, no 404s), robots.txt rules,
  private pages noindex and absent from the sitemap, unknown URLs answer 404.
- New `tests/seo/prepaint-ui.mjs` (`npm run test:seo:prepaint`): frame-by-frame check that the banner
  and tips show from the first frame for new visitors, never flash for returning ones, and that
  Cookie settings / Got it still work.
- `tests/consent/consent.mjs` updated for the new banner design (and the hint storage key, already an
  essential device-local preference, is now classified explicitly).
- `docs/seo/README.md`: where SEO lives, a checklist for every new page, and the keyword map.

---

## D. Competitor analysis

Observed in search results on 2026-11-24 (US results) plus notes from 2026-10-11
(`growth-outreach/seo-keywords.md`). No traffic or ranking data for competitors was available.

- **Adobe Acrobat online** dominates head terms ("free online document converter", "png to jpg"),
  with one page per conversion repeated across many country folders, plus app pages (Adobe Scan) that
  rank for "scan to pdf online free". Not realistically beatable on head terms.
- **Smallpdf** ranks with tool landing pages and app download pages for scanning, plus blog posts that
  answer how-to queries directly (for example a post on compressing scanned PDFs without losing quality).
- **iLovePDF** ranks with tool pages and a "scan to pdf" blog post translated into many languages.
- **PDF24, Sejda, Foxit, WPS**: per-tool pages with short explanations; free-tier limits are common
  (Adobe needs an account for repeated use; Smallpdf and Foxit gate unlimited use or OCR behind Pro).
- For "how to make a scanned pdf smaller" the results are largely Adobe community threads, Apple
  support pages and general articles: forum threads ranking is a sign of a weaker, winnable SERP.

Realistic opportunities (not copying anyone's content or design):

1. **How-to queries** where Google already shows the site (scan, scanned-PDF size, OCR, compress to a
   size): answer them more completely than forum threads, honestly including built-in OS methods.
2. **Differentiators that are true and verifiable**: processing in the browser (with a guide showing
   how to check), no account for any tool, no watermark, every limit stated on the page. Competitors'
   free tiers often require an account or limit use.
3. **Bing**, where the site already ranks on page one for "pdf scanner" terms: improve CTR through
   titles and descriptions (done for `/scan` and home); consider IndexNow (section F).
4. Product gaps that competitors cover and that would be straightforward here: **PDF to JPG/PNG**
   (the PDF renderer is already in the app) and a **PNG/JPG/WebP converter** page for the image
   editor's existing format output.

---

## E. Verification

All on the local production build (`npm run build`, then `next start` with `SUPABASE_URL` pointed
at a dead port so no analytics reach production).

| Check | Result |
|---|---|
| `npm run build` | passes (also `verify-theme-css` OK) |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors, 18 warnings (unchanged pre-existing baseline) |
| `npm run test:seo` (extended crawl) | **49 pages, 0 problems**: unique titles ≤60 and descriptions ≤160, canonicals, one H1 each, ≥220 words, OG image, valid structured data with no dangling references, guide dates match, lastmod valid, no broken links or redirect chains, robots rules, private pages noindex, 404 for unknown URLs |
| Same crawl against the **live** site (before deploy) | 11 problems, exactly the issues fixed here: 9 guides without a visible date, every lastmod identical, `/api/` not disallowed |
| Sitemap lastmod | 6 distinct real dates (29 URLs at the 2026-11-14 baseline, 12 at 2026-11-24, guides at their own dates); previously all "now" |
| `tests/consent/browser.mjs` (build with placeholder Clarity ID) | 35 passed, 0 failed |
| `tests/consent/consent.mjs` | 69 passed, 0 failed (after updating the two assertions described above) |
| `tests/ui/hydration-fallback.mjs` | all passed |
| `tests/ui/theme.mjs` | 25 passed, 0 failed |
| `npm run test:seo:prepaint` | all passed |
| Mobile layout (375 px) | no horizontal scroll; new home sections render in light and dark |

### Lab performance, before → after

Chrome, mobile emulation (412×823), 4× CPU slowdown, ~1.6 Mbps / 150 ms network, cold cache, median
of 3 loads, local build (so TTFB is local and not comparable to production). Not Lighthouse itself:
Lighthouse is not installed in the project and PageSpeed Insights was over quota.

| Page | LCP before | LCP after | CLS before | CLS after |
|---|---|---|---|---|
| / | 2.86 s | 1.19 s | 0.004 | 0.004 |
| /scan | 3.81 s | 1.14 s | 0.004 | 0.004 |
| /tools/compress-pdf | 2.79 s | 1.07 s | 0.178 | 0.004 |
| /convert/pdf-to-word | 2.81 s | 1.09 s | 0.004 | 0.004 |
| /guides/how-to-scan-a-document-to-pdf | 2.75 s | 1.15 s | 0.004 | 0.004 |

Unthrottled CLS on all tool pages at 412 px: 0.14-0.34 before, ≤0.004 after (all 8 tool pages
measured); /create-word-document 0.35 → 0.04 (phone) and 0.27 → 0.05 (desktop). All 25 other
landing pages measured ≤0.009. JavaScript transferred is unchanged (e.g. home 244 KB, /scan 495 KB);
the home HTML grew from 14 KB to 18 KB with the new sections. Total Blocking Time is unchanged within
noise (home 230-330 ms; /create-word-document stays high at about 1.3-1.5 s, from the editor itself:
a separate optimisation, not done here).

Not verified: field data (no CrUX data yet), real devices, Safari/Firefox, and the production
deployment (nothing was deployed).

---

## F. Outstanding work

### After deploying (needs the owner's Search Console / Bing access)

1. Deploy (pushing `web-only` deploys production). Then in Google Search Console:
   - Sitemaps: resubmit `https://www.freepdfscanner.com/sitemap.xml` (it now has real lastmod dates).
   - URL inspection → Request indexing, a few per day, in this order: `/tools/compress-pdf`,
     `/convert/pdf-to-word`, `/tools/protect-pdf`, `/tools/sign-pdf`, `/tools/pdf-editor`, `/convert`,
     `/jpg-to-pdf`, `/merge-pdf`, then the three new guides and the two rewritten ones.
   - Re-run `node tests/seo/crawl-audit.mjs https://www.freepdfscanner.com` and expect 0 problems.
2. Bing Webmaster Tools: resubmit the sitemap; use URL Submission for the same pages.
3. Measure after 4 weeks (compare with the figures in section A): Google indexed count and the
   "Discovered - currently not indexed" list; impressions/CTR/position for the scan and file-size
   guides; Bing CTR for `/scan` and `/`; which URL Google picks for "free pdf converter" and
   "edit pdf online free".
4. PageSpeed Insights for `/`, `/scan` and `/tools/compress-pdf` (mobile) once its quota resets; the
   Core Web Vitals report once there is enough field data.

### Recommended next (not done)

- **IndexNow** for Bing/Yandex: a key file in `public/` and a ping of changed URLs after each
  deploy. Free, but it sends data to an external service on every deploy, so it is the owner's call.
- **Product gaps worth building** before writing pages for them: PDF to JPG/PNG (pages to images),
  and an image format converter page (PNG to JPG, JPG to PNG, WebP to JPG) on top of Edit Image's
  existing output formats.
- **Future guides** (each only with real tool support): Word to PDF keeping fonts and layout (the
  converter's font matching is a genuine differentiator); how to merge PDFs on a phone; how to fill in
  and sign a PDF form; how to compress a PDF to 100 KB/200 KB (check what the 20 KB minimum target
  achieves first); JPG vs PNG vs WebP; how to delete or rotate pages permanently.
- Performance: the Word creator's Total Blocking Time (~1.3-1.5 s lab), and `/scan`'s 495 KB of
  JavaScript on first load.
- Consider whether the 8 near-duplicate tool URLs (`/tools/add-text`, `/tools/draw` …), which
  canonicalise to `/tools/annotate` and `/tools/sign-pdf`, should stay crawlable: Google showed
  `/tools/add-date` 5 times (with 1 click) despite the canonical. Leave as is unless they start
  outranking their canonical pages.
- Keep `utils/seo/updated.ts` honest: bump a date only when that page's content really changes.
