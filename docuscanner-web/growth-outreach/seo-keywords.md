# SEO keywords & content (qualitative — no volume/ranking data accessed)

Competitors seen in search (2026-10-11): iLovePDF, Smallpdf, Adobe Acrobat online (incl. compress-to-1MB pages), PDF24, Sejda, Stirling-PDF, BentoPDF, PDFEdit (browser OCR, searchable output), PDF Candy, Investintech, OCR2Edit, OCRConvert, NewOCR, FastOCR, Compress-PDF.com.

| Query theme | Intent | Existing page | Content gap / next topic |
|---|---|---|---|
| jpg to pdf / png to pdf / image to pdf (multiple images into one) | Transactional | /jpg-to-pdf, /png-to-pdf, /convert/image-to-pdf, guide | Add FAQ: page order, size, privacy |
| scan to pdf (free, phone, no app) | Transactional | /scan-to-pdf, /scan, guide | Compare with built-in Notes/Drive scanners honestly |
| scanned pdf to text / OCR free no signup | Transactional | /pdf-to-text, /tools/ocr, guide | State limits (English, 50 pages); add searchable-PDF if built |
| compress pdf to 1MB / 2MB / 500KB (job/portal uploads) | Transactional, high volume (Adobe targets "1MB, 50KB" pages) | /tools/compress-pdf, guide | Pages per target size, if the slider can deliver them |
| word to pdf / pdf to word free | Transactional | /convert/word-to-pdf, /pdf-to-word | Fidelity guidance, fonts |
| pdf to excel / pdf to csv | Transactional | /convert/pdf-to-excel, /pdf-to-csv | Note scanned tables limits |
| sign pdf online free | Transactional | /tools/sign-pdf, guide | Signature legality disclaimer |
| password protect pdf/word/excel | Transactional | /tools/protect-* | One guide |
| private/offline PDF tools no upload | Informational/commercial | home claim | "How to check a site doesn't upload your file" (network tab) — trust content |
| iLovePDF alternatives | Commercial | none | Honest comparison page (own site) |

Technical items for the owner to check: titles/meta per landing page, internal links to the sitemap-only pages, structured data (FAQ/HowTo), Search Console verification.

## New guides (built 2026-10-11, NOT yet deployed) — queries, intent, internal links
Search volumes, rankings and traffic are unknown (no Search Console/analytics access). Queries below are hypotheses to be checked in Search Console after release.

### /guides/how-to-compress-a-pdf-to-1mb-or-2mb
- Audience: students, job and visa applicants, professionals hitting portal/email upload limits.
- Candidate queries: "compress pdf to 1mb", "compress pdf to 2mb", "reduce pdf size for upload", "compress pdf to 500kb", "pdf too large to upload".
- Intent: transactional/how-to. Competing results seen in search: Adobe's compress-to-1MB and 50KB pages, Smallpdf, Compress-PDF.com, iOS apps.
- Honest differentiators (verified in code): target presets 500 KB/1/2/5 MB + custom (min 20 KB), runs in browser, original never changed, states when target can't be reached, keeps original if saving is negligible.
- Internal links (ADDED 2026-10-11, uncommitted): from /tools/compress-pdf page and from /guides/how-to-reduce-pdf-file-size (reciprocal link), from /guides hub intro, and from the scan guide's "make the PDF smaller" paragraph.
- Distribution: DEV cross-post with canonical_url; answers to genuine "PDF too big to upload" questions once threads are verified (disclose affiliation).

### /guides/how-to-check-a-pdf-site-does-not-upload-your-file (H1/title: "How to check if a PDF site uploads your file")
- Audience: privacy-conscious users, small businesses handling client paperwork, people comparing document tools.
- Candidate queries: "does ilovepdf upload my files", "are online pdf tools safe", "pdf converter without uploading", "how to tell if a website uploads my file", "offline pdf tools browser".
- Intent: informational/trust; feeds commercial comparison. Caution: do not mention competitors' upload behavior as fact.
- Internal links to add: from the home page "Your files stay on your device" claim, /privacy, and each tool's privacy paragraph.
- Distribution: HN regular submission (optional), DEV post.

### /guides/ilovepdf-alternatives-compared (H1/title: "Free iLovePDF alternatives compared")
- Audience: people actively comparing free PDF utilities.
- Candidate queries: "ilovepdf alternatives", "free ilovepdf alternative no upload", "best free pdf tools", "smallpdf alternative", "pdf tools that don't upload files".
- Intent: commercial investigation. Heavy competition (many roundups seen: PrivaTools, aservus, techshali, SourceForge, AlternativeTo); a vendor's own page is unlikely to outrank them quickly — expect it mainly to convert existing visitors and support directory listings.
- Internal links to add: from the home page footer or /tools, and from the privacy guide (already linked both ways via related lists).

## Internal linking — status (2026-10-11, in the working tree, NOT committed or deployed)
Implemented (verified by crawling the local production build; 36 sitemap URLs, all 200):
- Footer "Guides" column now lists all 8 guides, so all 3 new guides are linked from every other sitemap page (35 of 35 each).
- /tools/compress-pdf: related list now leads with the compression guide.
- /guides/how-to-reduce-pdf-file-size: related list links the compression guide. Privacy guide related list links the alternatives guide.
- A "See how to test whether a PDF site uploads your file" sentence under "Your files and privacy" on 23 tool/converter/landing pages.
- Anchor text uses each guide's own title; no page has more than 2 links to the same guide.
Deliberately NOT changed: homepage privacy badge, the legal privacy policy text.
Still to do after deploy: Search Console URL submission, then measure guide -> tool click-through and organic impressions from real data. Footer links appear on the guide's own page too (existing site-wide footer behavior).

