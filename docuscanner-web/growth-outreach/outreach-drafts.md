# Outreach drafts (DRAFTS ONLY — nothing has been sent or submitted)

Claims below are limited to what was verified on the live site on 2026-10-11: files are processed in the browser and not uploaded (home page, /tools/ocr, privacy policy "features designed for local processing"); free, supported by ads; camera scan + upload; Image/Word/Excel ↔ PDF conversions; sign, annotate, OCR text extraction (English only, first 50 pages), compress, protect. Re-verify each claim on the day you submit. Do not say "no sign-up" for any tool you have not tested.

## D1 — Free-tool directories (public.tools form, webtoolslist.com)
**Name:** FreePDFScanner
**URL:** https://www.freepdfscanner.com
**Short description (≈200 chars):** Scan documents with your phone camera or upload files, then convert, sign, annotate, compress, or extract text from PDFs. Processing happens in your browser, so files are not uploaded.
**Why it fits:** Free, browser-only, covers scan-to-PDF, Image/Word/Excel↔PDF, OCR text extraction (English), compression.
**Honest limits to disclose if asked:** OCR is English only and does not produce a searchable PDF; ad-supported.
Pre-check before submitting to public.tools: they say listed tools "don't ask you to sign up" — confirm that holds for every tool.

## D2 — AlternativeTo / SourceForge / Capterra
**Tagline:** Free in-browser PDF scanner and toolkit — scan with your phone, convert, sign, compress.
**Description:** FreePDFScanner lets you capture pages with a device camera or upload files, tidy them up, and export a PDF. It also converts images, Word and Excel to and from PDF, signs and annotates, compresses PDFs and images, protects Office/PDF files, and extracts text from scans (English). Files are processed in the browser rather than uploaded. Free, supported by ads.
**Suggested "alternative to":** iLovePDF, Smallpdf, Sejda, PDF24 Tools (only if the platform asks; comparisons are the owner's call).

## D3 — SaaSHub: reuse D2.

## D4 — Product Hunt (personal account; do not ask for upvotes)
**Tagline (≤60 chars):** Scan and edit PDFs in your browser — files stay put
**Maker comment draft:** "I built FreePDFScanner because most free PDF sites make you upload private paperwork. Here, scanning, conversion, signing and compression run in your browser. It's free and ad-supported. Known limits: OCR is English only and doesn't yet make PDFs searchable. I'd value feedback on which conversion breaks first on your real files."
(Everything in that comment is verified except "I built" — owner to adapt.)

## D5 — Show HN (only if you can discuss technical details)
**Title:** Show HN: In-browser document scanner and PDF tools (no uploads)
**Body points:** how camera capture + crop work, tesseract.js self-hosted, custom DOCX→PDF layout engine, what fails (fonts, tables in scanned PDFs). Invite bug reports with files. No marketing language, no friends upvoting.

## E1 — Editorial pitch to independent "alternatives" roundup authors
(Send only after finding a real contact page, confirming the site is independent, and owner approval. Contact not yet identified.)
> Subject: Suggestion for your iLovePDF alternatives list — in-browser scanner
> Hi [name], I read "[article title]". One gap I noticed: none of the tools are built around scanning from a phone camera in the browser. FreePDFScanner (https://www.freepdfscanner.com) does scan-to-PDF, image/Word/Excel conversion, signing and compression, with files processed in the browser rather than uploaded. It's free and ad-supported; OCR is English only. If useful, I can give you a test checklist or anything to verify. No obligation — thanks for maintaining the list.
> — [Owner name], [role], info@freepdfscanner.com

## C1 — Educational content ideas (own site and DEV)
1. "How in-browser OCR works (and where it fails)" — links to /tools/ocr, /guides/how-to-extract-text-from-a-scanned-pdf.
2. "Image to PDF without uploading your ID" — /convert/image-to-pdf.
3. "Getting a PDF under a portal's size limit" — /tools/compress-pdf.
4. "Scan a signed form from your phone" — /scan + /tools/sign-pdf.

## Community reply template (use ONLY on a specific, recent, on-topic question; check rules first)
Answer the question fully with tool-agnostic steps (e.g. built-in phone scanner, OS print-to-PDF), then: "If you want a browser option that doesn't upload files, FreePDFScanner (disclosure: I run it) does this: [direct tool URL]." Always disclose affiliation. One reply per thread, no DMs.
No live threads are drafted yet because none were verified (see growth-opportunities.md).

## Compliance prerequisites before any send
- Confirm support@freepdfscanner.com and info@ mailboxes actually receive mail (a prior handover note flagged support@ as missing — re-test).
- Real sender name + postal/identity details in commercial email footer where required (CAN-SPAM; UK PECR/GDPR for recipients in UK/EU; Nigeria NDPA given policy references). Not legal advice.
- Maintain an opt-out list (suppression file) before first send: `growth-outreach/optout.csv` (not created yet).

---
# Guide distribution drafts (added 2026-10-11; guides are NOT deployed yet — do not publish until they are live)

## C3 — DEV Community cross-post (compression guide) — OWNER PUBLISHES
Front matter:
```
---
title: How to get a PDF under 1 MB or 2 MB (and what to do when it won't fit)
published: false
tags: pdf, productivity, webdev, beginners
canonical_url: https://www.freepdfscanner.com/guides/how-to-compress-a-pdf-to-1mb-or-2mb
---
```
Body: write a shorter, adapted version (not a copy): why scans are large, how a target size works, when a text-only PDF cannot shrink, what to try. Disclose: "I run FreePDFScanner, the tool used in the examples." Link to the original once. Check DEV's Terms/Code of Conduct on self-promotion first (that page was not covered by the editor guide I read).

## C2 — Hacker News regular submission (privacy guide) — OPTIONAL
Guidelines read: self-promotion allowed only occasionally; use the original title; no editorializing; never ask anyone to vote.
Title (exact page title, minus site name): `How to check if a PDF site uploads your file`
URL: https://www.freepdfscanner.com/guides/how-to-check-a-pdf-site-does-not-upload-your-file
Do not post a Show HN for a guide (Show HN excludes reading material). Submit once; no reposts.

## Publications — no outreach recommended
- How-To Geek: its About page (found via search result) says it never accepts guest posts from people trying to get links. Do not pitch.
- MakeUseOf: official write-for-us page returned 404; secondhand sources describe a paid freelance application, not promotional placement. Do not pitch a product.
- Other developer/productivity publications: none verified as accepting product-related guest posts. Recommendation: do not email editors with product pitches. If you want editorial coverage, build something newsworthy first (e.g. publish measured, reproducible test results for in-browser compression), then look for outlets that cover that.

## Directories
Directory forms (public.tools, AlternativeTo, SaaSHub) take the product URL, not guides. Use the alternatives guide only if a profile has a free-text field that permits a reference link; do not add it where it reads as link-dropping.

## Communities (rules unverified — Reddit and Quora could not be accessed)
Once you supply real threads, the compression guide is relevant to "PDF too large to upload" questions and the privacy guide to "is X safe for my documents" questions. Answer first without the link; add the guide only if it adds a step the answer lacks; disclose that you run the site.
