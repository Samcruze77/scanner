# Listing submission kit (prepared 2026-10-11 — NOTHING SUBMITTED)

## Pre-flight results (read-only checks)
| Check | Result |
|---|---|
| Landing pages (12 checked) | All return 200, have unique title, meta description, canonical, H1 and JSON-LD. robots.txt allows crawling, lists sitemap, blocks /admin. On-page SEO basics are sound; no code change needed to list. |
| Inbound mail | MX = Namecheap email forwarding (eforward1-5). Whether support@ and info@ forward to a live inbox cannot be checked from DNS — **you must send a test to each.** |
| Outbound mail auth | Brevo DKIM (brevo1/brevo2) present; DMARC present with p=none; SPF includes only the registrar forwarder, not Brevo (DMARC still passes via DKIM alignment). Acceptable for low-volume sending; tighten later. |
| Tool claims | /tools/ocr: English, 50 scanned-PDF pages, no account for basic OCR (page text). Meta description says "up to 30 pages at a time" — body says 30 per run; consistent. "No sign-up" for every other tool is **untested** — test in a private window before using that phrase. |

## Submit these (you do the clicking / account creation)
Use these exact URLs so results land in analytics.

**1. public.tools** — form: https://tally.so/r/Gx75Qz
- Name: FreePDFScanner
- URL: https://www.freepdfscanner.com/?utm_source=public_tools&utm_medium=directory
- Description: Scan documents with your phone camera or upload files, then convert, sign, annotate, compress or extract text from PDFs. Runs in your browser, so files are not uploaded.
- Category suggestion: Utilities / Document Editors

**2. AlternativeTo** — open https://alternativeto.net/software/ilovepdf-com/ → "Add Alternatives" (needs your account; read their submission rules first).
- URL: https://www.freepdfscanner.com/?utm_source=alternativeto&utm_medium=directory
- Tagline: Free in-browser PDF scanner and toolkit — scan with your phone, convert, sign, compress.
- Description / tags: D2 in outreach-drafts.md. Tags: Free, Online, Privacy-focused only if the platform lets you tag claims you can support (browser-side processing is documented in your privacy policy).

**3. SaaSHub** — https://www.saashub.com/submit (register, verify product, then use Submit tab). utm_source=saashub.

**4. Product Hunt / Show HN / DEV** — hold until Week 4 (see plan).

**5. webtoolslist.com ($19)** — skip unless you approve spend.

## After each submission, record in experiment-tracker.csv: date, listing URL, live/not live.

## On-site pages — STATUS: built as guides in utils/seo/guides.ts, QA'd locally, awaiting your review/commit/deploy
1. **iLovePDF alternatives (honest comparison)** — sections: what runs in-browser vs server; what FreePDFScanner doesn't do (English-only OCR, no searchable-PDF output, scanned tables); when to use Stirling-PDF/BentoPDF (self-hosting/open source) instead. Rule: only describe competitors from their own pages, link to them.
2. **Compress PDF to 1 MB / 2 MB** — walk-through using the quality slider and live estimate; note results vary and the app keeps the original if compression doesn't make it smaller (verify wording against the tool before publishing).
3. **How to check a site isn't uploading your file** — browser Network tab steps; shows your claim is testable.
These need a code change in the web app; I haven't made one. Say the word and I'll implement them as a normal reviewed change (separate from this research task).
