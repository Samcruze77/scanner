# Third-party licence, copyright and service audit: FreePDFScanner

Audit date: 2026-10-26 (two rounds the same day, plus a Clarity consent follow-up). Repository state: `web-only` at `5c90fb3`: the second-round changes are committed as `68f5b03` and the Clarity withdrawal fix as `5c90fb3` (section 8); this document's own update is uncommitted.
This is an engineering audit of what the project actually contains and uses. It is **not legal advice** and it does not certify that the
website is free of licensing risk; sections 7 and 10 say exactly what was and was not established.

Status words used for every material item:

| Status | Meaning |
|---|---|
| **Verified compatible** | Evidence supports the intended use (a monetised website), subject to the listed obligations, and the obligations are met. |
| **Compatible with obligations** | Use is permitted, but specific conditions must be followed and are not all met or confirmed yet. |
| **Needs review** | The licence or the intended use is ambiguous, or a decision/plan/contract detail is needed. |
| **Not approved** | A material conflict or restriction was found. |
| **Unverified** | Evidence is insufficient for a reliable determination. |

---

## 1. Executive summary

**Overall: no GPL, AGPL, SSPL or non-commercial licence is among the 320 production npm packages of the website, and every resource the site serves is permissively or
OFL licensed, with its notice now served. One hosting-terms conflict (Vercel Hobby plan with ads) needs a decision, and a few provenance and terms items could not be
established. The audit does not support calling the whole project "fully compliant".** Two rounds of work are recorded here: the first audit and its notices, and a second
round (2026-10-26, evidence matrix in section 11) that investigated each open finding.

### 1.1 Verified and resolved

1. **Missing licence notices.** The site served none. `public/licenses/third-party-notices.txt` is now generated before every `dev`/`build` from the lock file and the shipped
   assets, linked from the footer ("Open-source notices"), and checked by `npm run test:compliance`.
2. **QPDF engine notices.** `/qpdf/qpdf.wasm` contains QPDF (Apache-2.0), libjpeg-turbo and zlib; their notices ship beside it (`/qpdf/NOTICE.txt`).
3. **QuickJS in PDF.js (`/pdfjs/wasm/quickjs-eval.*`): provenance and licence established.** The served files are byte-identical (SHA-256) to `external/quickjs/` in
   mozilla/pdf.js, whose own `LICENSE_QUICKJS` (MIT, Bellard and Gordon) and `LICENSE_PDFJS_QUICKJS` (MIT, Mozilla Foundation) are now shipped with them. PDF.js runs the engine
   only when `enableScripting` is set; nothing in the application sets it, and a test guards that.
4. **OCR core and model inventoried.** What is compiled into `tesseract-core` was taken from the upstream repository's pinned sources (tag v7.0.0) and confirmed by strings in the binary:
   Tesseract, Leptonica, libjpeg, libpng, giflib, libtiff, libwebp, zlib, openlibm. Their licence texts ship with the OCR assets. The English model is the integer version of tessdata_best (Apache-2.0).
5. **Privacy policy matches the implementation.** It now names the AI assistant's provider (Anthropic) and what is sent, IP2Location (when enabled), Microsoft's controller role with a link to its
   privacy statement, and advertisement images or videos loaded from advertiser or third-party servers. Each statement was checked against the code. This is a disclosure update, not a finding that the policy is legally sufficient.
6. **IP2Location integration identified exactly**: the REST "IP Geolocation API" (`https://api.ip2location.io/`, server-side key), not a downloaded database or LITE data. It is **dormant**: the handover
   document of 2026-10-05 records `GEO_PROVIDER` as "Not set", so no visitor IP address is sent to it today (the live environment was not read).
7. **`buffers@0.1.1` traced**: `exceljs 4.4.0 > unzipper 0.10.14 > binary 0.3.0 > buffers 0.1.1`; it is in the server bundle of the admin analytics export, not in what browsers receive. The notices now say plainly that the installed release declares no licence.
8. **Icon set compared** with Lucide 1.61.0, Feather 4.29.2 and Heroicons 2.2.0: no copied path (only trivial straight lines coincide).

### 1.2 Verified obligations that still require action

1. **Vercel Hobby plan with advertisements: Not approved.** Terms of Service section 4: "You shall only use the Services under a Hobby plan for your personal or non-commercial use." The Fair Use Guidelines
   count "The inclusion of advertisements" as commercial usage. The production project is recorded as Hobby (handover documents, 2026-10-05); the live plan could not be read today (API 403). Move to Pro before advertising or revenue.
2. **Before IP2Location is enabled**: use a plan that returns the fields wanted, show the attribution the free plan requires, and settle the Terms' 30-day limit on retaining cached results against the place names the analytics tables keep (section 11, row 2).
3. **Clarity: records of consent.** The full Terms of use (read 2026-10-26) say in section 4.2(d) that where consent is the lawful basis, "for individuals in the European Union, you must obtain consent for your use of cookies or other local storage, retain records of consent, and provide individuals with a clear means to revoke consent." The site keeps each visitor's choice only in that visitor's own browser (`ds_consent`) and holds no server-side record. Whether that satisfies the contractual duty is a legal question that is **not settled here**; no server-side storage was built. Needs review (operator or counsel).

### 1.3 Unverified items needing further investigation

Brand images and favicons (no source or licence record; committed 2026-10-08 by the repository owner), authorship of the in-house icons, the licence of `buffers@0.1.1` (probably MIT, from a secondary source), how the genuine Clarity script behaves with the app's consent signals (only a simulated Clarity was tested; section 8), the Clarity project's own Consent Mode setting and the third-party Clarity cookies, the current Vercel and Supabase plans, and the backend and mobile app (inventoried only).

### 1.4 Decisions that need your approval

Upgrading Vercel to Pro; whether and on which plan to enable IP2Location (and showing its attribution); the wording of the privacy policy (it is operator-supplied legal text and was edited here, with its "Last Updated" date changed to October 26, 2026);
the logo ownership declaration; whether to delete the unused template SVGs and, optionally, stop serving the unused QuickJS files; and whether to keep server-side records of consent.

---

## 2. Dependency inventory

Machine-readable, version-exact inventories (generated by `scripts/license-inventory.mjs`, no network, no added dependency):

| File | Project | Packages | Not development-only |
|---|---|---|---|
| `docs/compliance/license-inventory.json` | website (`docuscanner-web`) | 700 | 320 |
| `docs/compliance/license-inventory-backend.json` | `../backend` (Express API, read only) | 592 | 473 |
| `docs/compliance/license-inventory-mobile.json` | repository root (Expo/React Native app, read only) | 1605 | 1598 |

Re-run with `npm run license:inventory`; `npm run license:check` fails if a production package has a non-permissive licence that is not listed in `docs/compliance/license-review.json`.

### 2.1 Website: licences of the 320 production packages (declared in `package.json`, files read at the installed version)

| Declared licence | Packages | Note |
|---|---|---|
| MIT | 237 | |
| Apache-2.0 | 28 | includes `pdfjs-dist`, `tesseract.js`, `@vercel/functions` |
| ISC | 20 | includes `@neslinesli93/qpdf-wasm` (wrapper only, see 2.3) |
| BSD-3-Clause / BSD-2-Clause / 0BSD / Unlicense / BlueOak-1.0.0 / (MIT AND Zlib) | 3 / 1 / 2 / 1 / 1 / 6 | `pako` is MIT AND Zlib |
| CC-BY-4.0 | 1 | `caniuse-lite` (browser-support data used by build tools, not served) |
| (MIT OR GPL-3.0-or-later) | 1 | `jszip`: used under MIT |
| (MPL-2.0 OR Apache-2.0) | 1 | `dompurify` (via `jspdf`): used under Apache-2.0 |
| MIT OR SEE LICENSE IN FEEL-FREE.md | 1 | `rgbcolor` (via `canvg` via `jspdf`): MIT option offered |
| LGPL-3.0-or-later (with Apache-2.0 / MIT) | 14 | `@img/sharp-libvips-*`, `@img/sharp-*`: Next.js image optimisation binaries |
| MIT/X11 | 2 | `chainsaw`, `traverse`: the MIT (Expat) licence under an old name |
| (none declared) | 1 | `buffers@0.1.1`: see section 7 |

### 2.2 Direct dependencies of the website

| Package @ version | Purpose | Licence | Status |
|---|---|---|---|
| `next` 16.3.8, `react`/`react-dom` 19.2.4 | framework | MIT | Verified compatible |
| `@tiptap/*` 3.32.0 (core, react, starter-kit, pm and 5 extensions) | Create Word Document editor (ProseMirror) | MIT | Verified compatible |
| `docx` 9.7.1 | writes the .docx files | MIT | Verified compatible |
| `jszip` 3.10.2 | reads and writes zip packages (docx/xlsx, protected Office files) | MIT OR GPL-3.0-or-later; **use MIT** (`LICENSE.markdown` read) | Verified compatible |
| `exceljs` 4.4.0 | xlsx reading/writing | MIT (pulls `unzipper`, `binary`, `buffers`, `chainsaw`, `traverse`) | Verified compatible except `buffers` (Unverified) |
| `pdf-lib` 1.17.1, `@pdf-lib/fontkit` 1.1.1 | create, edit, protect-adjacent PDF work, font subsetting | MIT | Verified compatible |
| `pdfjs-dist` 6.3.289 | render and read PDFs; runtime copied to `/pdfjs` | Apache-2.0 | Verified compatible |
| `jspdf` 4.2.1 | image/page PDF output | MIT (pulls `canvg`, `rgbcolor`, `dompurify`, `core-js`...) | Verified compatible |
| `tesseract.js` 7.0.0 | OCR | Apache-2.0 | Verified compatible |
| `@neslinesli93/qpdf-wasm` 0.3.0 | Protect PDF (QPDF in WebAssembly) | wrapper ISC; contents Apache-2.0 + libjpeg-turbo + zlib | Compatible with obligations (met by the new `/qpdf/NOTICE.txt`) |
| `@supabase/supabase-js` 2.108.1, `@supabase/ssr` 0.12.0, `@supabase/server` 1.3.0 | accounts, history, edge-function calls | MIT | Verified compatible (service terms: section 4) |
| `@vercel/functions` 3.9.9 | request geolocation helpers | Apache-2.0 | Verified compatible (hosting terms: section 4) |
| `iso-3166-2` 1.0.0 | country and region names for analytics | MIT (data: ISO 3166-2 codes) | Needs review: the data's own provenance is not stated in the package |

Development-only direct dependencies (not shipped to visitors): TypeScript (Apache-2.0), ESLint and `eslint-config-next`, Tailwind CSS 4 and its PostCSS plugin (MIT),
`playwright-core` (Apache-2.0), `pptxgenjs`, `cfb`, `@xmldom/xmldom`, `@types/*` (MIT/Apache-2.0), and the five `@fontsource/*` font packages (OFL-1.1, **their font files are copied into `public/fonts/docx` and
therefore do ship: see section 3**) and `@tesseract.js-data/eng` (MIT wrapper, its model ships: see section 3). Development-only transitive packages with MPL-2.0: `axe-core` (tests),
`lightningcss` (Tailwind's CSS compiler). MPL-2.0 is file-level copyleft; both are used unmodified as build/test tools and are not distributed.

### 2.3 Transitive dependencies that need a note

| Package | Reached through | Finding | Status |
|---|---|---|---|
| `sharp` 0.35.4 and `@img/sharp-libvips-*` (LGPL-3.0-or-later) | `next` (optional) | libvips is LGPL. Used server-side by Next.js image optimisation (the logo uses `next/image`). We do not redistribute the binary: on Vercel the platform runs it. Re-review if the site is ever self-hosted or shipped in a container image. | Compatible with obligations |
| `buffers` 0.1.1 | `exceljs > unzipper > binary` | No `license` field and no licence file in the package. Debian's copyright record for the upstream project says Expat (= MIT) from its package.json, but notes there is no explicit copyright statement; another source lists it as unknown. The repository page could not be fetched. | Unverified |
| `chainsaw`, `traverse` | same chain | declare "MIT/X11", which is the MIT (Expat) licence | Verified compatible |
| `dompurify` 3.4.16 | `jspdf` | (MPL-2.0 OR Apache-2.0): Apache-2.0 chosen | Verified compatible |
| `rgbcolor` 1.0.1 | `jspdf > canvg` | "MIT OR SEE LICENSE IN FEEL-FREE.md": the MIT option applies | Verified compatible |
| `caniuse-lite` | `next`, `browserslist` | CC-BY-4.0 data: attribution is required if redistributed; it is build-time data and is also listed in the notices file | Compatible with obligations |
| `pako` (6 copies) | pdf/zip libraries | MIT AND Zlib: both notices are in the notices file | Verified compatible |

---

## 3. Asset inventory (fonts, icons, images, bundled runtime files)

| Resource | Where | Licence and source | Status |
|---|---|---|---|
| **Geist, Geist Mono** (site typeface) | `app/layout.tsx` via `next/font/google` (downloaded at build and self-hosted, no request to Google by visitors) | SIL OFL 1.1, "Copyright 2024 The Geist Project Authors" (`scripts/notices/geist-OFL.txt`, fetched from the vercel/geist-font repository) | Verified compatible; OFL text now in the notices file |
| **Carlito, Arimo, Tinos, Caladea, Cousine** (metric twins of Calibri, Arial, Times New Roman, Cambria, Courier New) | copied from `@fontsource/*` 5.3.0 to `/fonts/docx`; used by the Word→PDF converter and as web fonts for Create Word Document (`word-fonts.css`) | SIL OFL 1.1; licence texts shipped in `/fonts/docx/licenses` and in the notices file. No reserved font name is declared in the copyright lines. The OFL FAQ allows web-font use and embedding in documents; subsetting counts as modification (the @fontsource subsets are the standard Google-Fonts subsets). | Verified compatible |
| Calibri, Arial, Times New Roman, Georgia, Verdana | named in the editor and in exported .docx files | **Not bundled.** Used only if the visitor's device has them; .docx files refer to them by name and never embed them. | Verified compatible (no redistribution) |
| **PDF.js runtime** (`/pdfjs`): worker, CMaps, standard fonts, WASM decoders | `scripts/copy-pdf-assets.mjs` (pdfjs-dist 6.3.289) | Apache-2.0; Foxit-named fonts under the PDFium BSD-3 licence (`LICENSE_FOXIT`); Liberation Sans OFL; OpenJPEG BSD-2; qcms MIT; JBIG2 (PDFium + PDF.js). Licence files ship alongside. | Verified compatible |
| **QuickJS** (`/pdfjs/wasm/quickjs-eval.wasm`, `quickjs-eval.js`) | same package; byte-identical to mozilla/pdf.js `external/quickjs/` (SHA-256 compared 2026-10-26) | MIT: `LICENSE_QUICKJS` (Fabrice Bellard, Charlie Gordon) and `LICENSE_PDFJS_QUICKJS` (Mozilla Foundation) from that folder, which the npm package omits; now shipped as `/pdfjs/wasm/LICENSE_QUICKJS.txt` and in the notices file. Used by PDF.js only for PDF form scripting, which the application does not enable. | Verified compatible (provenance and notice resolved) |
| **OCR runtime** (`/ocr`): `worker.min.js` (tesseract.js 7.0.0), three `tesseract-core` 7.0.0 WASM builds, `eng.traineddata.gz` | `scripts/copy-ocr-assets.mjs` | tesseract.js and tesseract.js-core Apache-2.0. The core compiles in Tesseract (Apache-2.0), Leptonica, libjpeg, libpng, giflib, libtiff, libwebp, zlib, openlibm (list from the upstream `.gitmodules` at v7.0.0, each confirmed by strings in the binary; commits recorded in `scripts/notices/ocr-core.txt`). Model: `@tesseract.js-data/eng` 1.0.0 `4.0.0_best_int`, "Integerized Version of 'Tessdata Best'" (https://github.com/naptha/tessdata README); tessdata_best is Apache-2.0. | Verified compatible; licence texts ship in `/ocr/licenses/ocr-core-NOTICE.txt` and the notices file (texts are the projects' current files, not the pinned commits) |
| **QPDF engine** (`/qpdf/qpdf.wasm`) | `scripts/copy-qpdf-assets.mjs` | QPDF Apache-2.0 (qpdf.readthedocs.io licence page); libjpeg-turbo and zlib detected inside the binary | Verified compatible (notices shipped) |
| Logos and icons (`public/brand/*.png`, `app/icon.png`, `app/apple-icon.png`, `app/favicon.ico`) | site header, manifest, PWA install | Added by commit `bafb7f2` (2026-10-08, Samuel Ajose, "update FreePDFScanner branding and logo") and `9f0fd5b`. The PNG files carry no author, software or licence metadata. No design source, licence or purchase record exists in the repository. | **Unverified / unresolved**: the owner must confirm they created, commissioned or licensed them |
| In-house icon set | `components/ui/icons.tsx` (95 path elements) | File header calls it a drawn set (24 px grid, 1.75 px stroke). Compared against Lucide 1.61.0 (182 distinct paths), Feather 4.29.2 (1,474) and Heroicons 2.2.0 (8,549) from their npm packages: no non-trivial identical path (only two or eleven single-line paths such as `m5 12h14`). | Verified by comparison only (no copying detected); authorship remains the owner's statement |
| `public/next.svg`, `vercel.svg`, `file.svg`, `globe.svg`, `window.svg` | leftover `create-next-app` template files added in the first commit (`04b071c`, 2026-09-09); **not referenced anywhere** | The template's own files; `next.svg`/`vercel.svg` are the Next.js and Vercel logos (trademarks) | Needs review: unused, recommend deleting |
| Photographs, stock images, illustrations on pages | none found in `app/`, `components/`, `public/` besides the above | n/a | Verified (none found) |
| Guides, tool descriptions, landing-page text, sample documents in tests | `utils/seo`, `utils/assistant`, `tests/*` | written for the project; test documents are generated from deterministic word lists | Verified (no third-party content found) |
| `iso-3166-2` country and region data | `utils/admin/location.ts` (admin pages) | package 1.0.0, MIT licence file, Copyright 2014 Ola Holmström; the README does not state where its ISO 3166-2 data comes from | Needs review (low risk: admin-only names and codes) |

Exported documents: DOCX files from Create Word Document contain no fonts and no third-party graphics (only pictures the user adds, and signature images the user draws). PDFs made by the
Word→PDF converter embed *subsets* of Carlito/Arimo/Tinos/Caladea/Cousine; OFL FAQ 1.12 allows embedding a font (in full or subset) in a document, and says it does not change the document's licence. The
standard PDF base-14 fonts used by PDF libraries are referenced, not embedded. Files carry the generator name "FreePDFScanner" in their metadata.

---

## 4. API and service inventory

Checked against the providers' own pages on 2026-10-26 (URLs in sections 10 and 11). Credentials were not read or printed, and no hosted configuration was read or changed.

| Service | Used for | What the terms say | Data sent | Status |
|---|---|---|---|---|
| **Vercel** | hosting, builds, request geolocation headers, image optimisation. Pushing to `web-only` deploys production automatically. | Terms of Service section 4: "You shall only use the Services under a Hobby plan for your personal or non-commercial use." Fair Use Guidelines (updated 2026-09-14): "Hobby teams are restricted to non-commercial personal use only" and commercial usage includes "The inclusion of advertisements". Pro is $20 a month per Vercel's pricing page. | page requests, server logs | **Not approved** while on Hobby. Plan recorded as Hobby (handover documents 2026-10-05); live plan unverified (API 403) |
| **Supabase** (Auth, Postgres, Edge Functions) | accounts, History, analytics and ads functions | Pricing page: Free = 500 MB database, 50,000 MAU, 5 GB egress, 500,000 Edge Function invocations, **paused after 1 week of inactivity, no SLA, no automatic backups**. Terms: customer owns Customer Data; AI training on it needs written consent; the access grant is for "internal business purposes"; no free-plan statement on commercial use found. | account emails, saved History documents (when the user saves), analytics events | Needs review (plan not recorded; backups/retention gaps already noted in the handover) |
| **Microsoft Clarity** (`clarity.ms`, script only after consent) | session replay and heatmaps | Clarity FAQ (updated 2026-10-16): "free service forever", no traffic limits; explicit consent for visitors in the EEA, UK and Switzerland; operates as a data controller; data available to site owners up to 30 days; input boxes always masked. The full Terms of use (rendered in a browser 2026-10-26) add: the privacy notice must disclose that Microsoft may collect personal data and link the Microsoft Privacy Statement (done, policy section 7); for EU individuals the owner must obtain consent, retain records of consent and give a clear means to revoke (section 4.2(d)); Microsoft may use the data for purposes that include building advertising profiles (section 4.2(c)(iii), not yet stated in the policy); the account holder must be 18. FAQ: "Clarity shouldn't be used on any websites/apps targeting users under the age of 18." | interaction data, hosted on Azure | Compatible with obligations; records of consent **needs review**; behaviour of the genuine script **unverified** |
| **IP2Location.io** (`api.ip2location.io`, REST IP Geolocation API) | optional enrichment of visitor location in the analytics route; off unless `GEO_PROVIDER` and a key are set (recorded "Not set", 2026-10-05) | Terms of Service (https://www.ip2location.io/terms-of-service): access for the customer's "internal business operations"; cached results "must not be retained for more than thirty (30) consecutive calendar days"; API keys must not appear in client-side code. Pricing FAQ: "attribution is required if you are subscribed to our FREE plan or using keyless API" (a visible statement starting "[site] uses IP2Location.io" with a link "IP geolocation"); no attribution on paid plans. Free plan 50,000 queries a month; the free sample shows region and city, not district. | visitor IP address and the API key as query parameters, from our server | Dormant. **Needs review before enabling** (section 11, row 2) |
| **Anthropic API** (`api.anthropic.com`) | optional "Ask me" AI answers; the built-in guide works without it. On when `ANTHROPIC_API_KEY` is set (recorded not set earlier; live value not read) | Commercial Terms: customer owns outputs and may power its own products; Anthropic "may not train models on Customer Content from Services"; use must follow the Usage Policy; no competing-product or resale use. | the question (500 characters at most), up to 6 earlier messages, the page path; emails and long digit runs removed first; never documents, file names, passwords or tokens | Compatible with obligations; privacy policy now discloses it |
| **Google Fonts** | `next/font/google` downloads Geist at build time | Font licence is OFL; no visitor request to Google | none from visitors | Verified compatible |
| **Vercel Analytics / Speed Insights** | not used | No `@vercel/analytics` or `@vercel/speed-insights` package, import or script in the code | none | Verified (not used) |
| Advertisements | the site's own campaigns (`supabase/functions/ads-eligible`, `components/ads/AdSlot.tsx`): advertiser images (`<img src>` from the campaign's asset URL), click-through links, and YouTube/Vimeo embeds only from an allow-list and only after advertising consent | no ad-network SDK (AdSense, etc.) in the code; each advertiser's own terms are outside this audit | the browser's IP address and details reach the image host and, after consent, the video player host | Disclosed in the privacy policy (section 8); Needs review if a network is added |
| Brevo and Namecheap (domain email forwarding and DNS) | operations outside the code (per project notes) | not part of the repository; terms not audited | n/a | Unverified (out of scope of the code audit) |
| Stripe, Cloudinary, AWS S3, Neon, Redis (BullMQ) | **backend only** (`../backend/package.json`) | not part of the website; not audited. | | Out of scope; listed so they are not forgotten |

There is no third-party content-delivery of fonts, scripts or images other than the Clarity script (consent-gated) and the services above.

---

## 5. Feature mapping

| Feature | Libraries, assets and services it depends on |
|---|---|
| Scan to PDF, page editor, crop/rotate, annotate, text, signature, add image | `pdf-lib`, `pdfjs-dist` (+ `/pdfjs`), browser canvas; in-house icons |
| Sign PDF / Add signature | same, plus the shared signature dialog (drawn/typed/uploaded image) |
| Compress PDF / image | `pdf-lib`, `pdfjs-dist`, browser canvas |
| Protect PDF | QPDF WASM (`/qpdf`, Apache-2.0 + libjpeg-turbo + zlib) |
| Protect Word / Excel / PowerPoint (when enabled by `FEATURES`) | `jszip` (MIT option) and the project's own packaging code |
| OCR (extract text) | `tesseract.js`, `/ocr` core WASM, `eng.traineddata` (Apache-2.0) |
| Word ⇄ PDF, Excel ⇄ PDF, PDF → Word/Excel/CSV/text | `docx`, `exceljs`, `jszip`, `pdfjs-dist`, `@pdf-lib/fontkit`, Carlito/Arimo/Tinos/Caladea/Cousine fonts (OFL) |
| **Create Word Document** | `@tiptap/*` (ProseMirror), `docx`, `jszip`, Carlito/Arimo/Tinos web fonts (OFL, only when the device lacks Calibri/Arial/Times New Roman), IndexedDB/localStorage drafts |
| Print | browser print; no library |
| Accounts, History, delete account | Supabase (Auth, Postgres, Edge Functions) |
| Analytics, geography, ads | own Supabase edge functions; Vercel geolocation headers; Microsoft Clarity (consent-gated); IP2Location.io (optional) |
| Ask Me assistant | built-in guide (own text); Anthropic API (optional) |
| Site typeface | Geist / Geist Mono (OFL) |

---

## 6. Obligations

| Obligation | Applies to | How it is met |
|---|---|---|
| Keep the copyright and licence notice with copies (MIT, ISC, BSD, Apache-2.0, Zlib, OFL) | all npm packages in the application, PDF.js assets, fonts, OCR assets | `public/licenses/third-party-notices.txt` (generated before every `dev` and `build`; linked in the footer as "Open-source notices"); licence files also remain beside the PDF.js, OCR, QuickJS and font assets |
| Apache-2.0 NOTICE / licence text for QPDF, and the IJG acknowledgement for libjpeg-turbo | `/qpdf/qpdf.wasm` | `scripts/notices/qpdf-wasm.txt`, copied to `/qpdf/NOTICE.txt` and included in the notices file |
| BSD/MIT/zlib/PNG/IJG/Leptonica notices for what is compiled into the OCR core, Apache-2.0 for the model | `/ocr/core/*.wasm.js`, `/ocr/lang/eng.traineddata.gz` | `scripts/notices/ocr-core.txt`, copied to `/ocr/licenses/ocr-core-NOTICE.txt` and included in the notices file |
| MIT notices for QuickJS and pdf.js.quickjs | `/pdfjs/wasm/quickjs-eval.*` | `scripts/notices/pdfjs-quickjs.txt`, copied to `/pdfjs/wasm/LICENSE_QUICKJS.txt` and included in the notices file |
| OFL: licence text must accompany the fonts; fonts may not be sold alone | Geist, Carlito, Arimo, Tinos, Caladea, Cousine | licence texts shipped in `/fonts/docx/licenses` and the notices file; the fonts are not sold |
| Attribution on the free IP2Location.io plan; 30-day limit on retaining cached results | only if that provider is enabled | **not met, and not needed while it is off**; decision required before enabling (section 11, row 2) |
| CC-BY-4.0 attribution for `caniuse-lite` | build-time data | listed in the notices file |
| LGPL (libvips) | only if the binary is redistributed | not redistributed on Vercel; see 2.3 |
| Disclose processors to visitors | Anthropic (if enabled), IP2Location (if enabled), Microsoft Clarity, Vercel geolocation, advertisement hosts | privacy policy sections 7, 8 and 9, updated 2026-10-26 and checked against the code by `tests/compliance/notices.mjs` |
| Keep records of EU consent (Clarity Terms excerpt) | Microsoft Clarity | **open legal question**: the choice is stored in the visitor's browser only (`ds_consent`); the Terms require records of consent and a means to revoke (section 4.2(d)). Revocation exists (Cookie settings) and is now signalled to Clarity; whether a browser-side record is a sufficient "record" is not established. Needs review |
| Source disclosure | none required: no GPL/AGPL code is used (jszip is used under MIT) | n/a |
| Hosting plan matches use | Vercel | **not met if Hobby** (Terms section 4) |

---

## 7. Problems and uncertainties

Status after the second round (details and evidence in section 11):

1. **Vercel Hobby plan with ads: Not approved.** Action: move the project to Pro before advertising or revenue; confirm the live plan in the dashboard.
2. **IP2Location.io: Needs review before it is enabled.** Dormant today. Choose a plan that returns the wanted fields; add the free-plan attribution if the free plan is used; settle the 30-day retention limit on cached results against the stored place names.
3. **Clarity: records of consent: Needs review.** The full Terms (section 4.2(d)) require, for EU individuals, consent, retained records of consent and a clear means to revoke. Revocation exists. The only record is the visitor's own browser storage; whether that is enough is a legal question (separate from Microsoft's technical requirements). No server-side storage was built; the operator or counsel decides.
4. **Supabase plan: Needs review.** Record which plan production uses; Free has no SLA or automatic backups and pauses after a week of inactivity.
5. **`buffers@0.1.1`: Unverified.** Probable MIT (Expat) per Debian's copyright record; the upstream repository no longer resolves and the installed release ships no licence. It is only in server bundles. The notices say this plainly. To clear it, obtain the upstream licence text or upgrade `exceljs` to a release that no longer depends on `unzipper > binary > buffers`.
6. **Brand images (logos, favicons, PWA icons): Unresolved.** No source or licence record, no embedded metadata; the repository owner added them on 2026-10-08. Needs the owner's declaration (and to keep the design files).
7. **In-house icons: authorship unconfirmed, no copying detected** against three common icon sets.
8. **`@neslinesli93/qpdf-wasm` repository shows no LICENSE file** (`package.json` says ISC). The licences of the binary's contents are established from QPDF's own repository and strings in the binary; the wrapper's own licence statement could not be confirmed from its repository.
9. **`iso-3166-2` data provenance: Needs review** (admin-only; low risk).
10. **Unused template SVGs (`next.svg`, `vercel.svg`, ...)**: delete when convenient (trademark logos, unreferenced).
11. **Backend and mobile app:** inventoried only (section 2); their service terms (Stripe, Cloudinary, AWS, Neon, Redis, Apple/Google sign-in) and the LibreOffice binary the backend's Docker image relies on were **not** audited.
12. **Sources that could not be read in full:** the Google Fonts FAQ, Vercel's live plan (API 403) and the `buffers` repository. Conclusions about them rest on the pages that could be read.
13. **Clarity: genuine-script behaviour, project settings and third-party cookies: Unverified.** All browser tests use a simulated Clarity (a stub that records the `window.clarity(...)` calls). The genuine tag could not be fetched (the tag URL returns 400 for a placeholder project id) and an attempt to run Clarity's open-source client library (v0.8.68, not confirmed to be the version the tag serves) with traffic blocked wrote no cookies in either direction, so it shows nothing. Not established: that the genuine script removes `_clck`/`_clsk` when sent the denied signal; whether the project's Consent Mode setting (Settings, Setup; Microsoft says it is on by default for EEA/UK/CH traffic) is on; whether the third-party cookies Microsoft lists (`CLID`, `ANONCHK`, `MR`, `MUID`, `SM`) are set while `ad_Storage` is denied, or how they could be removed (they sit on Microsoft's domains, out of this site's reach). The site's own pre-consent behaviour is tested: no Clarity script or request and no Clarity cookies before the visitor allows session recordings.
14. **Clarity: under-18 restriction: assessed, not a finding, not a legal conclusion.** Microsoft: "Clarity shouldn't be used on any websites/apps targeting users under the age of 18." The wording is about targeting. FreePDFScanner is a general-purpose document tool; a search of `app/`, `components/` and `utils/` for audience-directed wording (students, school, kids, teen, classroom) found only code identifiers, and privacy policy section 15 already says Clarity will not be used for a site or experience specifically targeted at children under 18. Whether a general-audience site that minors can visit "targets" them is the operator's (or counsel's) call. An age notice would not change who the site targets and was not added. Separately, the Terms (preamble) say the Clarity account holder represents being 18 or older.

**Resolved in the second round:** QuickJS provenance and notice; the contents and notices of the OCR core and model; privacy-policy disclosure of Anthropic, IP2Location, Microsoft's controller role and advertisement hosts; the exact IP2Location integration; the `buffers` dependency path.

---

## 8. Remediation

First round (committed as `9bcbec0`, `c8ae67a`):

| Change | Files |
|---|---|
| Third-party notices generated before `dev`/`build`, linked from the footer, git-ignored like the other generated assets | `scripts/copy-notices.mjs`, `package.json` (`predev`, `prebuild`), `.gitignore`, `components/layout/Footer.tsx` |
| Notices for QPDF, libjpeg-turbo and zlib served beside the engine | `scripts/notices/qpdf-wasm.txt`, `scripts/copy-qpdf-assets.mjs` |
| Geist OFL text kept in the source | `scripts/notices/geist-OFL.txt` |
| Licence inventory tool, review list and npm scripts | `scripts/license-inventory.mjs`, `docs/compliance/license-review.json`, `package.json` |

Second round (2026-10-26, committed as `68f5b03`):

| Change | Files | Why (verified evidence) |
|---|---|---|
| QuickJS notice shipped beside the files and in the notices file | `scripts/notices/pdfjs-quickjs.txt`, `scripts/copy-pdf-assets.mjs`, `scripts/copy-notices.mjs` | files byte-identical to mozilla/pdf.js `external/quickjs/`; its licence files are MIT |
| OCR core and model notices shipped beside the assets and in the notices file | `scripts/notices/ocr-core.txt`, `scripts/copy-ocr-assets.mjs`, `scripts/copy-notices.mjs` | upstream `.gitmodules` at v7.0.0 and strings in the binary; licence texts from each project |
| `buffers` is described honestly in the notices (no licence declared, what is known) | `scripts/copy-notices.mjs` | installed release has no licence; Debian record says Expat |
| Privacy policy: Anthropic, IP2Location, Microsoft's controller role and link, advertisement hosts; "Last Updated" date | `app/privacy/page.tsx` | each statement checked against `utils/assistant/server.ts`, `utils/assistant/sanitize.ts`, `utils/analytics/geoProviders.ts`, `components/analytics/MicrosoftClarity.tsx`, `components/ads/AdSlot.tsx` |
| `--check` never writes; new compliance test and npm script `test:compliance` | `scripts/license-inventory.mjs`, `tests/compliance/notices.mjs`, `package.json` | a check must not change committed files |
| This report: evidence matrix (section 11) and corrections | `docs/compliance/THIRD_PARTY_LICENSE_AUDIT.md` | |

Clarity consent follow-up (committed as `5c90fb3`):

| Change | Files | Why (verified evidence) |
|---|---|---|
| When a visitor withdraws "Session recordings", the app first calls `clarity("consentv2", { ad_Storage: "denied", analytics_Storage: "denied" })`, waits 300 ms (`REVOKE_SETTLE_MS`), then reloads. Before this, it deleted the first-party cookies and reloaded without telling Clarity. | `components/analytics/MicrosoftClarity.tsx` | Microsoft's Consent Mode page: "As a site owner, you're responsible for informing Clarity any changes in user consent, so that Clarity can remove any previously set cookies." `consentv2` is "the latest and recommended method"; the older `consent` call is "planned for deprecation" (and in clarity-js 0.8.68, read from source, `consent(false)` is the same as `consentv2` with both denied). The new test failed on the old code (no denied signal) and passes on the fix. |
| Browser test of the exact `consentv2` arguments (accept all, reject, preference changes, withdrawal with the denied signal recorded before the reload, saved choice re-sent on the next visit, withdrawing a non-Clarity category sends nothing) and cookie removal and no tracking after reload; `npm run test:consent:clarity` | `tests/consent/clarity-signals.mjs`, `package.json` | **Simulated Clarity only** (see below) |
| Two static guards in the unit test: the denied signal precedes the reload; the deprecated `clarity("consent", ...)` is not used | `tests/consent/consent.mjs` | |

What these tests establish and what they do not. The tag URL is answered by a stub that logs every `window.clarity(...)` call, including calls queued before it ran, into `sessionStorage` so they survive a reload; all traffic to Microsoft is intercepted and nothing is sent. They therefore prove what **the app** sends, in what order, and what the app does to its own page and cookies. They do **not** prove how the genuine Clarity script reacts (cookie removal by Clarity, session ending, no-consent mode), which is **unconfirmed**: the genuine tag could not be loaded and a direct run of the open-source library produced no usable result (section 7, item 13). The cookie-removal check in the test uses cookies the test itself plants, and the app's own cleanup (`purgeCategory("recordings")`) removes them before Clarity is told, so that check covers the app's cleanup, not Clarity's.

No server-side consent storage, database table or additional banner was added. A draft of such a store was written and then removed unused; it is not part of the repository.

Corrections to the first round's text: the code never reads a neighbourhood from IP2Location (`neighborhoodSuburb` stays empty); the "QuickJS fork" worry and the "OCR libraries unverified" item are resolved; the Vercel plan evidence now includes the handover documents.

Not changed, on purpose: the Vercel plan, any hosted setting or environment variable, IP2Location configuration, any dependency or font, the brand assets and the unused template SVGs. Each of those needs a decision or evidence from the owner.
The notices script never fails a build (it prints a warning and exits 0), and the inventory tool is a development script with no dependencies, so the production dependency set is unchanged.

Clarity follow-up, run against HEAD `5c90fb3` (2026-10-26/27): `npm run test:consent` 68 passed, 0 failed (static guards); `npm run test:compliance` 9 passed, 0 failed; `npm run license:check` "no production package needs a licence review"; `npx tsc --noEmit` clean; with `NEXT_PUBLIC_CLARITY_PROJECT_ID=zzTESTzz1 npm run build` and `next start`, `node tests/consent/clarity-signals.mjs` 20 passed, 0 failed (on the code before the fix it was 18 passed, 2 failed: no denied signal on withdrawal) and `node tests/consent/browser.mjs` 35 passed, 0 failed. All Clarity browser tests are **simulated** (stub tag, traffic intercepted); no test used the genuine Clarity script.

Tests (second round): `npx tsc --noEmit` clean; `npx eslint .` 0 errors, 17 warnings (none in files changed here); `npm run build` exit 0 three times (normal, with a placeholder Clarity id for the consent test, and normal again; the build runs the copy and notices scripts); `npm run test:compliance` 9 passed, 0 failed; `npm run license:check` "no production package needs a licence review"; `npm run test:consent` 66 passed, 0 failed; `NEXT_PUBLIC_CLARITY_PROJECT_ID=zzTESTzz1 npm run build` then `BASE_URL=http://localhost:3116 CLARITY_ID=zzTESTzz1 node tests/consent/browser.mjs` (exercises the privacy page) 35 passed, 0 failed; `npm run test:ocr` 7 checks passed and `npm run test:ocr:ui` 6 checks passed (the OCR asset copy script changed). `node tests/ui/theme-visual.mjs` still reports 34 passed, 3 failed ("dialog, input and scanned page" for each theme): the same three failures occur on the deployed baseline `32f7aef` (cookie banner `role="dialog"` stays open), so they are not caused by this work.

---

## 9. Ongoing compliance process

Before adding anything new:

1. **Dependency:** run `npm run license:check` after installing it. A new production package that is not plainly permissive stops the check until it is assessed and added to `docs/compliance/license-review.json` with the reasoning. Read the licence *file at the installed version*, and for dual-licensed packages record which option is used.
2. **Font or asset:** record its source URL, licence and version in section 3 *before* committing it. Accept SIL OFL 1.1, Apache-2.0, MIT/BSD or CC0; anything "free for personal use", "free download", or without a licence file is refused. Keep the licence text with the file.
3. **Service or API:** read the provider's terms and pricing for the *plan actually used*, check commercial use, attribution, storage/caching, retention, data-training and regional rules, then add it to section 4 and to the privacy policy if personal data (IP addresses, document text, emails) goes to it.
4. **WebAssembly or binary blobs:** list what is compiled into them (the strings in the file and the upstream build script) and ship those licences next to them (as done for QPDF).
5. **Generated files:** `npm run build` regenerates the notices file from the lock file; commit lock-file changes so the inventory matches.
6. **Review dates:** re-run the inventories and re-read the Vercel, Supabase, Clarity, IP2Location and Anthropic terms at least every six months or when a plan changes.

---

## 10. Verification evidence and limits

Checked on **2026-10-26** (second round the same day). "Local" means the licence file inside the installed package or shipped asset was read at the version shown in the inventory.

| Conclusion | Evidence |
|---|---|
| Hobby is for personal, non-commercial use; advertisements are commercial use | Terms of Service section 4, https://vercel.com/legal/terms ; Fair Use Guidelines, https://vercel.com/docs/limits/fair-use-guidelines (`last_updated: 2026-09-14`); https://vercel.com/docs/plans/hobby (`last_updated: 2026-09-14`); https://vercel.com/pricing FAQ: "Our Hobby plan is for personal, non-commercial use." |
| Project is on Hobby | `handover/src/developer.html` line 194 ("Hobby plan") and 201, `cofounder.html` line 112 (documents dated 2026-10-05); project notes 2026-09-19. Vercel API: `list_teams` returned no teams, `get_team` for the account returned 403; `get_project` and `list_deployments` worked (deployment `dpl_4jAxpdss...` of `32f7aef`, target production) |
| IP2Location.io: free plan 50K queries/month, attribution template, no attribution on paid plans | https://www.ip2location.io/pricing (FAQ "Is attribution required to use IP2Location.io?") |
| IP2Location.io Terms: internal business use, 30-day cache limit, keys not in client code, no attribution clause | https://www.ip2location.io/terms-of-service |
| IP2Location integration is the REST API, server-side, optional | `utils/analytics/geoProviders.ts` (`https://api.ip2location.io/`, key in query string on the server); `GEO_PROVIDER` "Not set" in `handover/src/developer.html` line 186 |
| Supabase Free plan limits, no SLA/backups, pausing | https://supabase.com/pricing ; terms: https://supabase.com/terms |
| Clarity free, consent in EEA/UK/CH, controller role, 30-day access, masking | https://learn.microsoft.com/en-us/clarity/faq (`ms.date: 2026-10-16`); sample disclosure wording https://learn.microsoft.com/en-us/clarity/setup-and-installation/privacy-disclosure (`ms.date: 2025-05-14`) |
| Clarity Terms of use: disclosure, EU consent, consent records and revocation (4.2), advertising-profile use (4.2(c)(iii)), 18+ account holder | https://clarity.microsoft.com/terms rendered in headless Chrome on 2026-10-26 (22,057 characters of text; the page is a JavaScript application, which is why earlier plain fetches returned nothing). Primary source, read in full for those clauses; the rest of the document was not analysed. Whether the Terms in force differ from this rendering is not checked |
| Clarity Consent API v2, Consent Mode, cookies list, erase cookies, FAQ (restrictions, revocation) | https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-consent-api-v2 (`ms.date: 2025-08-28`), `.../consent-mode` (`2025-08-14`), `.../clarity-cookies` (`2026-10-16`), `.../clarity-api`, https://learn.microsoft.com/en-us/clarity/faq (`2026-10-16`); read 2026-10-26 |
| The app sends the exact `consentv2` arguments, denied before reload on withdrawal, nothing for other categories | `tests/consent/clarity-signals.mjs` against a production build with a placeholder Clarity id (**simulated Clarity**, traffic intercepted); static guards in `tests/consent/consent.mjs` |
| What the genuine Clarity script does with those signals | **not established**: tag URL returns HTTP 400 for a placeholder id; clarity-js 0.8.68 (MIT, from scripts.clarity.ms, version not confirmed to match the tag) was read as source and run once in Chrome with traffic blocked, with no usable cookie result |
| Under-18 restriction and the site's audience | Clarity FAQ "Are there any restrictions on using Clarity?"; code search for audience-directed wording; `app/privacy/page.tsx` section 15 |
| Anthropic outputs owned by customer, no training on Customer Content from the Services | https://www.anthropic.com/legal/commercial-terms |
| What the assistant sends to Anthropic | `utils/assistant/server.ts`, `utils/assistant/sanitize.ts` (`MAX_QUESTION_CHARS = 500`, `MAX_HISTORY_TURNS = 6`, `scrub`) |
| QPDF is Apache-2.0; its NOTICE text | https://qpdf.readthedocs.io/en/stable/license.html ; https://raw.githubusercontent.com/qpdf/qpdf/main/NOTICE.md and `LICENSE.txt` |
| libjpeg-turbo licences (IJG + BSD-3-Clause); zlib licence | https://raw.githubusercontent.com/libjpeg-turbo/libjpeg-turbo/main/LICENSE.md and `README.ijg`; https://raw.githubusercontent.com/madler/zlib/develop/LICENSE |
| What is inside `qpdf.wasm` | strings in `public/qpdf/qpdf.wasm`: "qpdf is licensed under the Apache License", "Copyright (C) 1991-2021 The libjpeg-turbo Project", zlib messages; no OpenSSL |
| What is inside `tesseract-core` | https://raw.githubusercontent.com/naptha/tesseract.js-core/v7.0.0/.gitmodules and the `third_party` entries of that tag (GitHub contents API, commit ids recorded in `scripts/notices/ocr-core.txt`); strings in `public/ocr/core/tesseract-core-lstm.wasm.js` (decoded WASM): Tesseract, leptonica, PNG, zlib, JPEG, GIF, TIFF, WebP |
| Licence texts of those libraries | raw files from DanBloomberg/leptonica (`leptonica-license.txt`), mirrorer/giflib (`COPYING`), glennrp/libpng (`LICENSE`), libtiff on gitlab (`LICENSE.md`), webmproject/libwebp (`COPYING`), JuliaMath/openlibm (`LICENSE.md`), LuaDist/libjpeg (`README`), tesseract-ocr/tesseract (`LICENSE`), fetched 2026-10-26 (current branches, not the pinned commits) |
| Tesseract model is Apache-2.0, and `4.0.0_best_int` is the integer version of tessdata_best | https://github.com/tesseract-ocr/tessdata_best (README and LICENSE) ; https://github.com/naptha/tessdata (README, LICENSE) |
| QuickJS files are pdf.js's own and MIT | https://github.com/mozilla/pdf.js/tree/master/external/quickjs (`README.md`, `LICENSE_QUICKJS`, `LICENSE_PDFJS_QUICKJS`, `quickjs-eval.wasm`, `quickjs-eval.js`); SHA-256 of both served files equals the upstream files and the files in `node_modules/pdfjs-dist/wasm` |
| OFL: embedding, web fonts, subsetting, licence text | https://openfontlicense.org/ofl-faq/ ; Geist: https://raw.githubusercontent.com/vercel/geist-font/main/OFL.txt ; `@fontsource/*/LICENSE` (local) |
| `jszip` dual licence, `dompurify`/`rgbcolor` alternatives, all other package licences | `package.json` and licence files (local), inventories in `docs/compliance/` |
| `buffers`: path, version, probable Expat | `npm ls buffers`; `npm view buffers@0.1.1` (no licence field; tarball has no licence file); https://metadata.ftp-master.debian.org/changelogs/main/n/node-buffers/stable_copyright (secondary); github.com/substack/node-buffers returns 404 |
| Brand image provenance | `git log` for `public/brand`, `app/icon.png` (commits `bafb7f2`, `9f0fd5b`, `04b071c`); PNG chunk scan (no text, EXIF or provenance chunks) |
| Icon set comparison | `npm pack lucide-static@1.61.0 feather-icons@4.29.2 heroicons@2.2.0` into a temporary folder and a path-string comparison with `components/ui/icons.tsx` |
| PDF.js asset licences | `public/pdfjs/LICENSE`, `standard_fonts/LICENSE_FOXIT`, `LICENSE_LIBERATION`, `wasm/LICENSE_*` (local) |

**Limits of this audit.** Licences were read from package metadata and shipped files, not from every source file; a scanner or a licence field cannot prove the absence of copied code or unlicensed
assets. Patents were not assessed. Transitive packages without a licence file (60 production packages) rely on their declared licence field. Trademark use (names, logos) was not assessed. Provider terms change; they were read
on the date above and only for the plans and features the code uses. Sources that could not be read are listed in section 7, item 12. The backend, mobile app, infrastructure outside the repository (DNS, email, Supabase
project settings, Vercel project settings other than the deployments, and any environment variable value) and the users' own content were not audited. This document does not replace advice from a lawyer, particularly for the ad business, the privacy policy and any
decision where a status says "Needs review".

---

## 11. Evidence matrix (second round, 2026-10-26)

Columns: resource and exact package or asset; resolved version and source path; actual use in FreePDFScanner; licence or contract terms and source; obligations (attribution, notice, privacy, commercial use, redistribution); status; remediation and verification evidence.
Status here is one of **Verified**, **Action required** or **Unverified**.

| # | Resource / asset | Version and path | Actual use | Terms and source | Obligations | Status | Remediation and evidence |
|---|---|---|---|---|---|---|---|
| 1 | **Vercel** hosting plan | project `scanner`, `prj_Wuts1iprXJoo8ogxobppyQ6ebVmx`, team scope "sam-project4"; latest production deployment `dpl_4jAxpdssNNWfB2eGGbG3jjExgeNz` | hosts the production website that shows advertisements | Terms of Service §4: "You shall only use the Services under a Hobby plan for your personal or non-commercial use." Fair Use Guidelines: commercial usage includes "The inclusion of advertisements". Hobby may be disabled "with or without notice" (§4). Pricing: Pro $20/month. (https://vercel.com/legal/terms, /docs/limits/fair-use-guidelines, /docs/plans/hobby, /pricing) | commercial use requires Pro or Enterprise | **Action required** (plan recorded as Hobby in the 2026-10-05 handover documents; live plan unverified, API 403) | Recommended: upgrade to Pro before ads or revenue (the handover documents already say the same). Not changed: hosted configuration is out of scope. |
| 2 | **IP2Location.io** IP Geolocation API | no package: a `fetch` to `https://api.ip2location.io/?key=...&ip=...&format=json` in `utils/analytics/geoProviders.ts` (`createIp2LocationProvider`), called from the analytics routes via `app/api/analytics/*` | optional: adds region, city, district, postal code to analytics geography; off unless `GEO_PROVIDER=ip2location` and a key are set; handover 2026-10-05: "Not set" | Terms (https://www.ip2location.io/terms-of-service): internal business operations; cached data not retained over 30 consecutive days; keys not in client-side code. Pricing FAQ: attribution required on the Free plan and keyless API, none on paid plans; Free = 50,000 queries/month. | before enabling: choose plan; attribution text on the site if Free; retention of derived place names vs the 30-day cache rule; privacy policy (done); keep the key server-side (it is) | **Action required before enabling**; dormant, so nothing is violated today | Policy now names it (`app/privacy/page.tsx` §9). Retention of the stored place names (`analytics_events` city/region/district) is a legal question the Terms do not settle; decide with the provider's support or counsel. |
| 3 | **Anthropic API** | `fetch` to `https://api.anthropic.com/v1/messages` in `utils/assistant/server.ts`; default model `claude-haiku-5-5` | optional AI answers in the "Ask me" assistant when `ANTHROPIC_API_KEY` is set | Commercial Terms (https://www.anthropic.com/legal/commercial-terms): customer owns outputs; no training on Customer Content from the Services; Usage Policy applies | disclose to visitors what is sent; keep key server-side (it is) | **Verified** (use permitted); disclosure added | Privacy policy §9 now states what is sent (question ≤500 characters, ≤6 earlier messages, page path; emails and long digit runs removed; no documents, file names, passwords) and that the conversation is not stored. `tests/compliance/notices.mjs` ties the wording to `MAX_HISTORY_TURNS` and `scrub`. |
| 4 | **Microsoft Clarity** | script `https://www.clarity.ms/tag/<id>` loaded by `components/analytics/MicrosoftClarity.tsx` after consent | session replay and heatmaps, consent-gated; `consentv2` granted signal on opt-in and a `consentv2` denied signal on withdrawal (`5c90fb3`) | FAQ (2026-10-16): free, no limits, controller role, consent in EEA/UK/CH, access up to 30 days, inputs masked. Full Terms read 2026-10-26: 4.2(b) disclosure and link, 4.2(c)(iii) advertising-profile use, 4.2(d) consent, records of consent, means to revoke. FAQ: not for sites targeting under-18s. | privacy notice must disclose Microsoft's collection (done, with the Microsoft Privacy Statement link; the advertising-profile use is not yet stated); EU consent, **records of consent** and revocation; signal revocation to Clarity | **Needs review** (records of consent: legal question); **Unverified** (genuine-script behaviour, project Consent Mode setting, third-party cookies); app-side signalling **verified against a simulated Clarity only** | Policy §7 updated. The choice is stored only in the visitor's browser (`utils/consent/consent.ts`); whether that is a sufficient record is for the operator or counsel and no server-side store was built. Withdrawal now informs Clarity (tests: `tests/consent/clarity-signals.mjs`, simulated). Audience: general-purpose tool, no child-directed wording found; policy §15 states the position (section 7, item 14). |
| 5 | **Vercel Analytics / Speed Insights** | none | not used | n/a | n/a | **Verified** (not used) | no package, import or script in `app/`, `components/`, `utils/`, `package.json` |
| 6 | **Fonts**: Geist, Geist Mono (`next/font/google`); Carlito, Arimo, Tinos, Caladea, Cousine (`@fontsource/*` 5.3.0 → `/fonts/docx`) | `app/layout.tsx`; `scripts/copy-font-assets.mjs`; `components/wordCreator/word-fonts.css` | site typeface; Word-compatible layout and Word→PDF output | SIL OFL 1.1 (licence files in each package and `scripts/notices/geist-OFL.txt`); OFL FAQ https://openfontlicense.org/ofl-faq/ | licence text with the font; no sale of the fonts alone | **Verified** | OFL texts ship in `/fonts/docx/licenses` and the notices file |
| 7 | **Advertising resources** | `components/ads/AdSlot.tsx`, `supabase/functions/ads-eligible` | the site's own campaigns: advertiser image URL, click-through link, YouTube/Vimeo embed (allow-listed hosts, only after advertising consent) | each advertiser's terms are theirs; no ad-network SDK present | privacy disclosure of third-party hosts (done); consent gate for embeds (present) | **Verified** (as implemented) | Policy §8 updated; revisit if an ad network is added |
| 8 | **`buffers`** | 0.1.1 via `exceljs 4.4.0 > unzipper 0.10.14 > binary 0.3.0 > buffers 0.1.1`; `node_modules/buffers`; registry `buffers@0.1.1` | server bundle of `app/api/admin/analytics-export` only (browser builds use exceljs's own dist); not in client chunks | no licence field or file in the installed release; Debian copyright record (secondary): Expat, James Halliday; the GitHub repository returns 404 | MIT would need its notice if redistributed; it is only run on the server | **Unverified** (probable MIT) | `scripts/copy-notices.mjs` records it as "no licence declared" with what is known; clear it by obtaining the upstream licence text or upgrading `exceljs` |
| 9 | **Brand images**: `public/brand/*.png` (8 files), `app/icon.png`, `app/apple-icon.png`, `app/favicon.ico` | added by `bafb7f2` / `9f0fd5b` (2026-10-08, Samuel Ajose); first `04b071c` | header logo (`components/layout/Logo.tsx`), manifest, PWA and browser icons | no source, licence or purchase record; PNG chunks hold no author/software/licence text | rights must rest with the operator (copyright owner or licence) | **Unverified / unresolved** | Needs the owner's declaration of how the logo was made or licensed; keep the source files. Nothing changed. |
| 10 | **In-house icons** | `components/ui/icons.tsx` (95 path elements) | UI icons | self-authored per the file header | none if authored in-house | **Verified by comparison** (no copying found); authorship unconfirmed | path-string comparison against Lucide 1.61.0, Feather 4.29.2, Heroicons 2.2.0: 0, 2 and 11 identical strings, all single straight lines |
| 11 | **OCR core and model** | `tesseract.js` 7.0.0, `tesseract.js-core` 7.0.0, `@tesseract.js-data/eng` 1.0.0 (`4.0.0_best_int`) → `public/ocr/{worker.min.js,core/*.wasm.js,lang/eng.traineddata.gz}` | OCR (Extract text), in the browser | Apache-2.0 (tesseract.js, core, model); compiled-in Tesseract (fork `Balearica/tesseract` @ `2a9c1c4`), Leptonica `4af068b`, libjpeg `6c0fcb8`, libpng `a37d483`, giflib `fa37672`, libtiff `b51bb15`, libwebp `20ef03e`, zlib `21767c6`, openlibm `ae2d916` (upstream tag v7.0.0) | notices for each | **Verified** | `scripts/notices/ocr-core.txt` → `/ocr/licenses/ocr-core-NOTICE.txt` and the notices file. Limit: licence texts are the projects' current files, not the pinned commits. |
| 12 | **QuickJS** | `pdfjs-dist` 6.3.289, `node_modules/pdfjs-dist/wasm/quickjs-eval.{wasm,js}` → `public/pdfjs/wasm/` | served with the PDF.js runtime; run only for PDF form scripting (`enableScripting`), which no application code sets | MIT: `LICENSE_QUICKJS` (Bellard, Gordon) and `LICENSE_PDFJS_QUICKJS` (Mozilla Foundation, 2026) in mozilla/pdf.js `external/quickjs/` | MIT notice with the files | **Verified** | files byte-identical to upstream (SHA-256); notices shipped as `/pdfjs/wasm/LICENSE_QUICKJS.txt` and in the notices file. Options if the payload matters: keep serving them (done), or stop copying them in `copy-pdf-assets.mjs`; scripting is off, so removal would not change behaviour, but it was not done. |
| 13 | **Template SVGs** `public/{next,vercel,file,globe,window}.svg` | added by `04b071c` | none: no reference anywhere | create-next-app template files; two are the Next.js and Vercel logos (trademarks) | n/a | **Action required** (optional clean-up) | recommend deleting; not done (unrelated to any feature) |
| 14 | **Supabase** plan | hosted project; client packages `@supabase/*` MIT | accounts, History, analytics, ads functions | pricing and terms as in section 4 | business plan with backups and no pause if monetised | **Unverified** (plan not recorded) | record the plan; Free has no SLA/backups |

---
