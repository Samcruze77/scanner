# SEO: how this site is set up, and rules for every new page

SEO is a permanent requirement for FreePDFScanner (https://www.freepdfscanner.com). Read this before
adding or renaming a public page, a tool, a converter or a guide. The detailed 2026-11-24 review,
with the data behind these rules, is in [2026-11-24-seo-report.md](2026-11-24-seo-report.md).

## Where things live

| Concern | File |
|---|---|
| Site name, base URL, which deployments are indexable | `utils/seo/site.ts` |
| `<head>` metadata for every public page (title, description, canonical, OG/Twitter) | `utils/seo/metadata.ts` (`pageMetadata`, `privateMetadata`) |
| Tool and keyword landing pages: title, description, H1, steps, limits, FAQ, related links | `utils/seo/landing.ts` |
| How-to guides (with in-text links written `[anchor](/path)`) | `utils/seo/guides.ts`, rendered by `app/guides/[slug]/page.tsx` |
| Structured data (Organization, WebSite, WebPage, WebApplication, BreadcrumbList, Article) | `utils/seo/schema.ts` |
| Near-duplicate tool pages that canonicalise to a fuller page | `utils/seo/toolCanonicals.ts` |
| Sitemap (and its `<lastmod>` dates) | `app/sitemap.ts`, `utils/seo/updated.ts` |
| robots.txt | `app/robots.ts` |
| Short alias URLs (301/308 to the real page) | `next.config.ts` `redirects()` |
| Automated checks | `tests/seo/crawl-audit.mjs` (`npm run test:seo`), `tests/seo/prepaint-ui.mjs` |

## Checklist for a new public page

1. **One intent, one URL.** Check the keyword map below. If an existing page already targets the
   query, improve that page instead of adding a new one. Never create a page for a tool or format
   the product does not have (there is no PDF to JPG, PDF to PNG, PDF to PowerPoint or PowerPoint
   to PDF tool today).
2. **Metadata through `pageMetadata()`**: a unique title of at most 60 characters with the main
   query first (the site name is appended only when it fits), a unique, specific description of
   120-160 characters that says what the page does and why it is worth the click, and `path` set
   to the page's own canonical URL. Private or app-only pages use `privateMetadata()` (noindex).
3. **Exactly one H1**, then H2/H3 in order. The H1 can be more natural than the title.
4. **Real content in the server HTML**: how it works, supported files and honest limits, what
   happens to the file, a few genuine FAQs, and related links (see `SeoContent`). At least ~220
   words. No hidden text, no keyword lists, no copy that is the same as another page's.
5. **Structured data** only for what is visible and true: `WebApplication` (free offer, no
   ratings or reviews, ever), `BreadcrumbList` only when a breadcrumb is shown, `Article` for
   guides with the same date shown on the page.
6. **Internal links**: link to the page from at least two other relevant pages with descriptive
   anchor text (the footer alone is not enough for an important page), and link from it to the
   next logical tool or guide. Tool pages should link to their guide and back.
7. **Sitemap**: tool, converter and keyword pages are added automatically from the registries.
   Set the page's date in `utils/seo/updated.ts` when you publish it, and bump it (or a guide's
   `updated`) only when the content really changes. Never set lastmod to "now".
8. **No layout shift**: anything rendered only in the browser (a dynamically loaded tool, a
   tip, a banner) must have its space reserved in the server HTML. Measure CLS before shipping.
9. **Run** `npm run build`, start the build (`docuscanner-web-prod-isolated`), then
   `node tests/seo/crawl-audit.mjs http://localhost:3000 --strict` and fix every problem it lists.
10. **After deploying**: request indexing in Google Search Console for the new URL (URL inspection)
    and check Bing Webmaster Tools a week later.

## Keyword to page map (avoid cannibalisation)

Evidence: "GSC" or "Bing" means the query is verified in that console's data (2026-11-24); otherwise
the mapping is a judgement of search intent. No search-volume data is available to this project:
do not quote volumes.

| Query family | Intent | Owner page | Supporting pages |
|---|---|---|---|
| free pdf scanner, pdf scanner online (free) (Bing), brand | Navigational / hub | `/` | `/scan` |
| scan to pdf, scan pdf online, online document scanner (Bing, GSC) | Transactional | `/scan` | `/scan-to-pdf` (phone-specific), guide |
| scan to pdf with phone / iPhone / Android | Transactional | `/scan-to-pdf` | `/scan` |
| how to scan a document to pdf, how can i scan to pdf (GSC) | Informational | `/guides/how-to-scan-a-document-to-pdf` | `/scan` |
| free pdf converter, pdf converter online, convert pdf online | Transactional hub | `/pdf-converter` | `/convert`, `/` |
| online document converter, free document converter | Transactional hub | `/document-converter` | `/convert` |
| free pdf tools | Transactional hub | `/tools` | `/` |
| pdf to word (converter, free, online) | Transactional | `/convert/pdf-to-word` (`/pdf-to-word` redirects) | guide below |
| how to convert pdf to word, scanned pdf to word | Informational | `/guides/how-to-convert-pdf-to-word` | `/convert/pdf-to-word` |
| word to pdf, docx to pdf | Transactional | `/convert/word-to-pdf` (`/word-to-pdf` redirects) | |
| jpg to pdf | Transactional | `/jpg-to-pdf` | `/convert/image-to-pdf` |
| png to pdf | Transactional | `/png-to-pdf` | `/convert/image-to-pdf` |
| image to pdf, photos to pdf | Transactional | `/convert/image-to-pdf` (`/image-to-pdf` redirects) | guide |
| pdf to excel | Transactional | `/convert/pdf-to-excel` (`/pdf-to-excel` redirects) | `/pdf-to-csv` |
| excel to pdf, xlsx to pdf | Transactional | `/convert/excel-to-pdf` | `/guides/how-to-convert-excel-to-pdf` |
| free pdf editor | Transactional | `/tools/pdf-editor` | `/edit-pdf` |
| edit pdf online free | Transactional | `/edit-pdf` | `/tools/pdf-editor` (watch these two for overlap) |
| compress pdf (online), pdf compressor, reduce pdf size | Transactional | `/tools/compress-pdf` (`/compress-pdf` redirects) | guides below |
| how to make a scanned pdf smaller, reduce pdf file size (GSC) | Informational | `/guides/how-to-reduce-pdf-file-size` | `/tools/compress-pdf` |
| compress pdf to 1mb / 2mb / 500kb (GSC) | Informational + transactional | `/guides/how-to-compress-a-pdf-to-1mb-or-2mb` | `/tools/compress-pdf` |
| protect / password protect / lock / encrypt pdf | Transactional | `/tools/protect-pdf` (`/protect-pdf`, `/lock-pdf`, `/password-protect-pdf` redirect) | `/guides/how-to-password-protect-a-pdf` |
| password protect word / excel / powerpoint (GSC) | Transactional | `/tools/protect-word`, `-excel`, `-powerpoint` | |
| free ocr online, ocr pdf | Transactional | `/tools/ocr` (`/ocr` redirects) | |
| image to text, picture to text, scanned image to text (GSC) | Transactional | `/image-to-text` | `/tools/ocr` |
| pdf to text, extract text from pdf (GSC) | Transactional | `/pdf-to-text` | |
| extract text from scanned pdf, convert scanned pdf to text (GSC) | Informational | `/guides/how-to-extract-text-from-a-scanned-pdf` | `/tools/ocr`, `/pdf-to-text` |
| sign pdf online (GSC) | Transactional | `/tools/sign-pdf` | `/fill-and-sign-pdf`, guide |
| annotate pdf online (GSC) | Transactional | `/tools/annotate` | |
| merge / combine pdf | Transactional | `/merge-pdf` | |
| create word document online (free) (GSC) | Transactional | `/create-word-document` | guide |
| edit / crop / resize image online | Transactional | `/tools/edit-image` | |
| compress image, reduce jpg size | Transactional | `/tools/compress-image` | |
| ilovepdf alternative (GSC) | Commercial investigation | `/guides/ilovepdf-alternatives-compared` | |
| pdf to jpg, pdf to png, pdf to powerpoint, powerpoint to pdf | (no tool) | **do not target** until the tool exists | |
