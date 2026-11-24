# FreePDFScanner — full application audit (2026-11-24)

Branch `web-only`, starting commit `e65fdc9` (visit counter). Nothing was committed, pushed or
deployed. Production Supabase was only **read** (SELECT / EXPLAIN / advisors). All browser testing
ran against a local production build (`next build && next start`) whose server-side
`SUPABASE_URL` pointed at a dead local port, so no test could write analytics rows to production.

---

## A. Overall assessment

**Health: good.** The document tools are in better shape than most of the checklist feared. Output
quality is measured objectively by the existing audit suites, and those numbers are strong (see E).
Nothing in the core workflows (scan → edit → PDF, conversions, compression, protection, OCR, Word
creator, print) failed.

**Ready for normal users: yes, after this fix is deployed.** The one user-visible defect, the
Beige/Dark theme turning back into Light on the homepage, is a real production bug. Its root
cause is fixed here but not yet deployed.

**Serious outstanding item:** the theme fix could not be exercised against **Vercel's**
regeneration (see C). It needs one check on a preview deployment before production.

**Update, same day: Next.js security upgrade done** (see J). `next` 16.3.8 → 16.4.6 cleared the
2 critical + 1 high Next.js advisories; `npm audit --omit=dev` went from 10 advisories
(1 critical) to 2 moderate (exceljs → uuid, no applicable fix).

---

## B. Feature-by-feature testing

Inventory: 47 page routes, 7 API routes, 4 Supabase edge-function proxies, admin area (8 screens).
"Tested" below means operated in a real browser against the production build, with the output
file opened and measured. A loaded page alone never counts.

| Feature | How it was tested | Result |
|---|---|---|
| Scan / upload → edit → Create PDF → download / print / start over | theme, scanner, audit-scan, repeat-memory (15 rounds), editor, editor-images suites | Pass |
| Camera capture, multi-page camera sessions | scanner suite (simulated camera stream) | Pass (physical phone camera not tested) |
| Page editor: rotate, crop, enhance, annotate, signature, insert/crop image, move page, zoom | editor (74 checks), editor-images (21), zoom (18), pdf-edit (11) | Pass |
| Edit PDF / combine PDFs (import → Create PDF) | audit-scan, pdf-edit, quality-fixes (23) | Pass: text layer, vectors and page sizes kept |
| Word → PDF | docx unit suites (20+12+17+2+9+22), audit-convert | Pass: 10/10 markers, image at 320 dpi |
| PDF → Word (text and scanned/OCR) | pdf-word (17), audit-convert | Pass: 100% word recall, tables/lists rebuilt |
| Excel → PDF | excel-pdf (5), audit-convert | Pass: 133/133 values, A4 portrait/landscape per sheet |
| PDF → Excel / CSV | pdf2excel (18), audit-convert | Pass: all 12 numbers of the table recovered |
| Image tools (convert, edit, compress image) | images (19), images-e2e (27), images-quality (11), image-edit (37), image-edit-browser (36) | Pass |
| Compress PDF / image / Word / Excel | compress (38), compress-readability, audit-convert | Pass: never returns a larger file; text stays 98.9–100% readable |
| Protect PDF | protect (56 checks), audit-misc, new edge-inputs test through the UI | Pass: AES-256, no/wrong password refused by pdf.js |
| Protect Word/Excel/PowerPoint | protect suite (own verifier + container checks) | Pass, but see I: independent decryptors not installed here; feature flag is off by default |
| OCR (image → text, scanned PDF → Word) | ocr (7), ocr-ui (6), audit-convert | Pass, see E for accuracy |
| Create Word document (editor, drafts, .docx download) | word-creator (62), word-creator-browser, word-creator-layout (vs real Word line breaks) | Pass |
| Print | print (33), print-quality, audit-misc | Pass (prints page images at ~318 dpi, by design) |
| Auth: sign up / log in / forgot + reset password | auth (36, mocked Supabase auth) | Pass |
| History / saved documents | guest view in UI audit; signed-in save covered by auth mocks only | Partial, see I |
| Consent banner, analytics opt-in, Clarity gating | consent (68), consent-browser, consent-clarity | see G |
| Admin traffic exclusion | analytics admin-exclusion unit tests, admin-browser | see G |
| Help assistant | assistant (53), assistant-browser | Pass (no AI key set, so the offline answers path) |
| Install-app reminder, tips/guidance | install (71), install-browser, guidance (8), guidance-browser | Pass |
| SEO pages, guides, sitemap | seo crawl: 46 pages, 0 problems | Pass |
| Homepage visit counter | see D | Pass |

---

## C. Theme testing

**Results.** Light, Warm Beige and Dark were each chosen from the menu and checked by
**painted colour**, not just the attribute: at 375, 768 and 1280 px, with the OS in light and in
dark mode; across `/`, `/tools`, `/scan`, `/convert`, `/history`; in the Log in dialog and its
inputs, the page editor and the scanned page; after reloads; and after a full browser close and
reopen. Contrast was checked for text, links, notices, placeholder, focus, disabled and selected
states in each theme (all pass; e.g. Beige link 5.32:1, placeholder 4.8:1). The UI audit (20
screens × 5 widths × 3 themes) found no horizontal overflow and no low-contrast text. The scanned
page and print output stay paper-white in every theme, by design.

**Exact cause of "Beige keeps changing back to Light".** Reproduced on the live site: on the
homepage `<html>` had **no** `data-theme` attribute (so the Light default palette showed) while
localStorage and the menu still said `beige`. The console showed React error #418, a hydration
mismatch. The chain of events:

1. `e65fdc9` (visit counter) made the homepage ISR (`revalidate: 600`). Before that it was fully
   static.
2. When Vercel regenerates the homepage in the background, Next 16.3.8 renders it with the
   pathname **`/index`** (live payload: `"c":["","index"]`; the build-time copy and a local
   `next start` regeneration both give `["",""]`).
3. The phone bottom bar marks its Home tab active from `usePathname()`. The server HTML said
   "not active" and the browser said "active", so React raised a hydration mismatch.
4. React 19 then discards the server HTML and re-creates the page. In doing so it resets the
   attributes on `<html>`, wiping the `data-theme` set by the pre-paint script.

So it affected **any** saved theme (Dark too) and **only the homepage**, within 10 minutes of a
regeneration. Other pages kept the theme, which is why it looked intermittent.

**Fix (no CSS workaround):**
- `components/layout/usePagePathname.ts`: the navigation reads a normalised pathname (`/index`
  → `/`; no `/index` route exists), so a regenerated homepage renders exactly what the browser
  renders and there is no hydration error.
- `components/theme/ThemeKeeper.tsx` + `keepThemeApplied()` in `theme.ts`: defence in depth. If
  React ever resets `<html>` again (any future hydration error, on any page), a MutationObserver
  puts the saved theme back before the next paint.

**Verification.** `tests/ui/theme.mjs` 25/25 (3 new tests). New
`tests/ui/hydration-fallback.mjs` serves the real homepage with the exact live mismatch injected:
React does fall back (#418 seen) and Beige, Dark and Light all stay applied (on the old code the
attribute was lost). `theme-visual` 37/37 locally (it fails its "no hydration errors" check on the
live site today). **Not verified:** the regenerated page on Vercel itself; `next start` does not
reproduce Vercel's `/index` rendering. Check on a preview deployment.

---

## D. Live count (homepage "N visits")

**How it works.** A server component calls `public.public_visit_count()` with the secret key.
That function counts distinct analytics `session_id`s, excluding administrator accounts, their
browsers and their sessions. The result is cached for 10 minutes (`revalidate: 600`) and the badge
is hidden if the count can't be read. Only visitors who accepted analytics are recorded, so it is
a lower bound. It is **not real-time**: it updates on a page load at most every 10 minutes.

**Accuracy.** The function returned 2,181. An independent query written differently
(`NOT EXISTS`) also returned 2,181, and the live badge showed 2,181. The `NOT IN` clauses are
NULL-safe. Total sessions including admins: 2,440.

| Question | Finding |
|---|---|
| Refresh adds a visit? | No: the session id survives reloads. Tested (20 reloads). |
| Page navigation adds visits? | No. |
| Duplicate events inflate it? | No: it counts distinct sessions, not events. |
| Multiple tabs | **Defect, fixed.** The session id lived in per-tab sessionStorage, so every new tab opened from a bookmark or the address bar started a new session (contrary to the code's own comment). In production, 180 of 2,442 sessions (7.4%) began while the same browser already had a live session. Fixed in `utils/analytics/identity.ts`: the live session id is shared through localStorage. Existing in-flight sessions carry on. Consent withdrawal still deletes it. |
| Network drop / reconnect | Events sent while offline are lost (undercount, never inflation). The next activity continues the same session if within 30 minutes. |
| Load | 39 ms per call (EXPLAIN ANALYZE, 30k rows), at most once per 10 minutes, so about 144 calls/day. Grows linearly with the events table; fine for years at current volume. |
| Admins / bots | Admins are excluded by account, browser and session. Bots are only counted if they accept the consent banner (rare). |
| Privacy | Only an aggregate number leaves the server; the function is executable by `service_role` only; the secret key is not in any client bundle (scanned). |
| Subscription leaks / polling | None: no client polling or realtime subscription. |

Behaviour change from the multi-tab fix: `app_open` now means "a new session started", so a
second tab or a reload is no longer an app open. Historical rows are unchanged; the count stops
gaining extra visits from new tabs once this is deployed.

---

## E. Input and output quality (measured)

Formats exercised: PDF (text, vector, scanned, multi-page, Letter/A4, portrait/landscape,
protected, corrupted, truncated, empty, oversized), DOCX (headings, tables, images, page breaks,
accents, Yoruba/Igbo/Hausa text), XLSX (formats, formulas, merged cells, two sheets, a wide sheet),
CSV, JPG (0.1–48 MP), PNG (transparent, 45 MB), WebP, unsupported types, unusual file names, drag
and drop.

- **Images → PDF:** full resolution kept (4000×3000 stays 4000×3000); re-encode PSNR 43.6–58.5 dB
  (≥40 dB is visually identical); page orientation follows the photo; 48 MP input capped to 4096
  px on the long side with no crash.
- **Transparency:** transparent PNGs are flattened onto white in Scan → PDF (by design: paper).
  Logo PSNR 36.4 dB, slight.
- **Edit/Combine PDF:** text layer, vector drawing operators, fine detail (100%) and page sizes kept;
  mixed page sizes preserved in combined output.
- **Word → PDF:** all markers present, selectable text, image at 320 dpi, A4.
- **Excel → PDF:** all values present in full; each sheet on its own A4 page with the right
  orientation. Cells that Excel itself clips (a long text next to a filled cell) are clipped the
  same way, and numbers use the cell's format (e.g. General shows `7316.4`), as in Excel.
- **PDF → Word:** 100% word recall on the reference document; ruled and borderless tables, lists
  and headings rebuilt. Pictures in the PDF are not copied (stated on the page).
- **PDF → Excel:** table recovered with numbers as numbers.
- **Compression:** text stays selectable; readability 100% at Medium/High, 98.9% at Maximum; a
  result that wouldn't be smaller returns the original.
- **Protect PDF:** AES-256; opens only with the password; text and vectors kept (not rasterised).
- **OCR (English, 200 dpi scan):** 8/8 key words, 20/24 line identifiers exact (errors are O/0 and
  l/1 confusions, which the identifier-fix tool corrects); scanned PDF → editable Word works.
- **Print:** pages are printed as ~318 dpi images, not text (sharp on paper; not selectable in
  "Save as PDF" from the print dialog).
- **Bad inputs (new `tests/audit/edge-inputs.mjs`):** protected, corrupted, truncated, empty,
  oversized and unsupported files on Scan, PDF → Word and Compress PDF each give a specific message
  ("That PDF is password-protected…", "doesn't look like a valid PDF", "too large… under 25MB")
  with no crash, hang or false success.
- **File names, defect fixed:** converters and Protect replaced every non-ASCII character with
  `_`, so "Résumé – Q3 名前.pdf" downloaded as `R_sum_ _ Q3 _.docx`. This hurts any user writing in
  Yoruba, Igbo, Hausa or French. Now only characters operating systems refuse are replaced
  (`utils/files/filename.ts`).
- **Memory (new `tests/perf/repeat-memory.mjs`):** 15 rounds of upload → PDF → download → start over
  in one tab: JS heap +0.05 MB/round, DOM back to the same node count, every blob URL released
  (downloads keep theirs 30 s on purpose for Safari), no slowdown.

---

## F. Security and performance

- No secrets in client bundles; analytics and assistant endpoints have body-size caps and
  per-IP rate limits; the admin export rejects unauthenticated and forged tokens (unit tests).
- Files are processed in the browser. Verified at network level for Edit Image ("no request
  carries the picture"); the equivalent Protect suite (`tests/protect/browser.mjs`, which also
  checks that the password is never sent) needs a mock-Supabase build and was not run here.
- `npm audit --omit=dev`: 10 advisories. The ones that matter: **next** (critical, fix 16.4.6),
  **@vercel/functions → oidc → zod** (high, non-breaking fix), **exceljs → uuid** (moderate;
  the fix is a major *downgrade*, not applicable), **sharp/source-map-js** (build-time/transitive).
- Supabase advisors: leaked-password protection is off (dashboard setting);
  `ad_assets_caller_is_admin()` is callable by signed-in users (it only reveals whether the caller
  is an admin; low risk); 10 unused indexes (info).
- Performance: production build OK; no client polling. Theme switching, navigation and repeated
  processing showed no growth. PDF.js documents and OCR workers are explicitly destroyed.
- Browsers: Chrome 157 (all suites) and Edge 158 (theme, visual theme, hydration, edge inputs,
  images, print, zoom, scan audit). Safari/iOS could not be tested on this Windows machine.

---

## G. Test results

| Check | Result |
|---|---|
| Production build (`next build`, incl. TypeScript and the theme-CSS guard) | Pass ×3 (before, after the theme/session fixes, final) |
| Type check (`tsc --noEmit`) | Pass |
| Lint (`eslint`) | 0 errors, 18 warnings, all pre-existing (anonymous default exports in edge functions, one unused variable); changed files clean |
| Unit / Node suites: 20 suites | **1,077 checks passed, 0 failed** |
| Browser E2E battery (Chrome 157): 21 suites | **660 checks passed, 0 failed** |
| Final regression after all fixes: 21 suites, Chrome + Edge 158 | **496 checks passed, 0 failed, 2 check groups skipped** (Office independent decryptors not installed) |
| Measurement audits (scan, convert, misc, generation loss, compress readability) | Ran in Chrome and Edge; findings in E |
| SEO crawl | 46 pages, 0 problems |
| UI audit (20 screens × 5 widths × 3 themes) | 0 overflow, 0 low-contrast |
| `npm audit --omit=dev` | 10 advisories (see F) |
| Total | **2,233 checks passed, 0 failed** (some suites ran in more than one pass) |

**Failures seen during the audit, and what they were:**
- Theme suite on the *old* build: 24/25. The new "theme survives an `<html>` reset" test failed,
  as expected (the bug). It is 25/25 after the fix, in Chrome and Edge.
- `theme-visual` on the **live site**: fails "no console errors (no hydration mismatch)", which is
  the production bug. 37/37 locally after the fix.
- `theme-visual` 3 failures, locally and live: a stale test (it waited for "no dialog open", but
  the consent banner added later is also a dialog; and the editor's "Done" became "Done editing").
  Test fixed; not an app defect.
- 14 suites failed in under 5 s on the first battery: harness issue (they default to port 3117 or
  need `BASE_URL`). Re-run against the right server: all pass.
- `consent-browser`, `consent-clarity`, `admin-browser` need a build with a placeholder Clarity id:
  run on such a build, they pass 35/35, 20/20 and 18/18. They are the ones that exercise the session
  change.
- `audit-convert` Protect step: a pdf.js 6 API change in the test (`doc.destroy`). Fixed.
- `audit-scan` "stress PNG" timeout: the 45 MB PNG is correctly refused (25 MB limit, clear
  message shown); the audit expected it to be accepted.
- The repeat-memory test's first timing check tripped once on a single slow round while other
  suites ran in parallel; it now compares medians (heap/DOM/blob checks were always clean).
- No intermittent (flaky) app behaviour was observed.

---

## H. Changes made (uncommitted)

| File | Why |
|---|---|
| `components/layout/usePagePathname.ts` (new) | Normalises `/index` → `/` so the regenerated homepage hydrates without a mismatch |
| `components/layout/Header.tsx`, `MobileActionBar.tsx` | Use the normalised pathname |
| `components/theme/theme.ts` (`keepThemeApplied`), `components/theme/ThemeKeeper.tsx` (new), `app/layout.tsx` | Restore the saved theme if React ever resets `<html>` |
| `utils/analytics/identity.ts` | One session per browser across tabs (fixes ~7% visit inflation); `app_open` = new session |
| `utils/files/filename.ts` (new), `utils/convert/download.ts`, `utils/protect/protect.ts`, `components/tools/ProtectTool.tsx` | Keep the person's file name in any language in downloads |
| `tests/ui/theme.mjs` (+3 tests), `tests/ui/hydration-fallback.mjs` (new) | Theme regression tests, including a real hydration fallback |
| `tests/analytics/session-duration.mjs` (+5 tests) | Multi-tab, reload, idle-gap and legacy-session cases |
| `tests/files/filename.mjs` (new), `tests/audit/edge-inputs.mjs` (new), `tests/perf/repeat-memory.mjs` (new) | File names, bad inputs and Protect PDF via the UI, memory/slowdown |
| `tests/ui/theme-visual.mjs` | Was stale: it waited for "no dialog", but the consent banner (added later) is a dialog; and "Done" became "Done editing" |
| `tests/audit/audit-convert.mjs` | pdf.js 6 API (`task.destroy()`) |
| `package.json` | Scripts: `test:theme:hydration`, `test:perf:memory`, `test:filenames`, `test:edge-inputs` |
| `.claude/launch.json` | `docuscanner-web-prod-isolated` config (server-side Supabase URL pointed at a dead port for safe testing) |

No migrations, no configuration or environment changes, no new dependencies.

---

## I. Remaining issues / not tested

1. **Vercel regeneration path** not reproducible locally. After deploying, check that the live
   homepage payload no longer differs (`"c":["","index"]` may remain, but there must be no
   #418 in the console) and run `npm run test:theme:visual https://www.freepdfscanner.com`.
2. ~~Next.js security upgrade~~ done, see J.
3. **Office protection** was not checked by independent decryptors (msoffcrypto-tool and
   LibreOffice aren't installed here; installing them means downloading packages, so I did not do
   it unasked). The feature is off by default.
4. **Safari / iOS, physical phone camera, real Microsoft Word opening outputs**: not available on
   this machine.
5. **Signed-in flows against real Supabase** (save to account, history, delete account) were only
   tested with mocked auth, by design (no production writes).
6. **Leaked-password protection** in Supabase Auth is off (dashboard toggle; not changed).
7. The "N visits" badge is a 10-minute cached total, not a live counter. Making it live would need
   a client fetch or realtime channel, which isn't necessary for accuracy.

---

## J. Next.js security upgrade (done after the audit, same day)

| Package | Before | After | Why |
|---|---|---|---|
| `next` | 16.3.8 | 16.4.6 (exact pin, as before) | 2 critical, 1 high, 6 moderate Next.js advisories |
| `eslint-config-next` | 16.3.8 | 16.4.6 | kept in step with `next` |
| `@vercel/functions` | 3.9.9 | ^3.11.3 | clears the high zod advisory via `@vercel/oidc` / `@vercel/cli-config` |
| `dompurify` (via jsPDF), `source-map-js` (build only) | 3.4.16, 1.2.1 | 3.5.0, 1.2.4 | in-range `npm update`; low / high advisories |

`npm audit --omit=dev`: **10 → 2** (0 critical, 0 high). The remaining 2 moderate are `exceljs` →
`uuid`, whose only offered fix is a major *downgrade* of exceljs, so not applicable. Not used
`npm audit fix`: with `--omit=dev` it would have removed dev dependencies (TypeScript, Tailwind).

Upgrade notes checked in the bundled `version-16.md` guide: the only 16.4 removal
(`experimental.appNewScrollHandler`) isn't used; `turbopackFileSystemCacheForBuild: false` is
still supported and kept. No code or config changes were needed. The route table is identical to
the 16.3.8 build (66 routes; 35 static, 9 SSG, 22 dynamic) and the homepage is still prerendered
with `"c":["",""]`.

Licence inventory regenerated (`docs/compliance/license-inventory.json`): no new package names,
only version bumps; `license:check` reports nothing needing review. Versions updated in
`docs/compliance/THIRD_PARTY_LICENSE_AUDIT.md`.

**Regression on 16.4.6:** type check, lint (0 errors, same 18 warnings) and build pass. **64
suites** (23 unit + 35 browser in Chrome + 6 in Edge) all pass. The only failure was the
compliance inventory check before the inventory was regenerated; it is now 9/9. After the
dompurify/source-map-js bump: theme 25/25, hydration fallback, Excel → PDF, PDF quality,
quality fixes, memory and edge inputs re-run, all pass. On a placeholder-Clarity build:
consent 35/35, Clarity signals 20/20, admin exclusion 18/18. Output-quality measurements
(scan, misc, generation loss, compress readability) are **identical** to 16.3.8; SEO crawl 46
pages, 0 problems.

Still to check after deploying: whether Vercel's regeneration on 16.4.6 still renders the
homepage as `/index` (the fix in C works either way).
