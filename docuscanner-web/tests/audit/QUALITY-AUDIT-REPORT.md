# FreePDFScanner output-quality audit (2026-10-17)

Audited build: `web-only` at `bb5a966` (production build, `next start`), Chrome 155 headless, Windows.
Nothing was changed in the product. All audit scripts and fixtures are under `tests/audit/` (untracked).
Base-commit comparison: the code paths below are unchanged by the recent image-quality commits
(`db867d3`, `e8d4ff1`, `566ae35`), which only touched the *Add image* path, so every finding here is **pre-existing**.

## 1. Most serious problems (ranked)

| # | Severity | Problem |
|---|---|---|
| F1 | **Critical** | Every uploaded image is auto-cropped when document detection is "confident" (>= 0.55). Real content is cut away: a text page loses the right end of its lines, a photo loses the face, a logo is cropped. |
| F2 | **Critical** | Transparent PNGs (logos, signatures) uploaded through Scan / Image to PDF are flattened to an opaque JPEG; transparent areas turn **black** (PSNR 1.9 dB vs source). |
| F3 | **High** | "Edit PDF" turns every PDF into page pictures (about 171 dpi, JPEG q0.85). Text layer is lost (0 of 9,758 characters kept), vector drawing is lost, file grows 5 KB to 1,235 KB. Applies to any edit (sign, add text, reorder). |
| F4 | **High** | Every exported page is forced to A4 portrait. A landscape page becomes a small picture on a portrait sheet (210 x 162 mm on 210 x 297); Letter pages are rescaled to A4. |
| F5 | **High** | Word to PDF collapses a table whose `tblGrid` widths disagree with its cell widths (`tcW`): columns shrink to about 1.8 mm, text wraps one character per line, and the document grows from Word's 2 pages to 3. |
| F6 | Medium | PDF to Word: body lines are tagged as headings (36 of 149 paragraphs), hairline tables are not detected (0 tables), pictures are not copied (stated in the UI). |
| F7 | Low | Excel to PDF: second-sheet cells in default-width columns print clipped ("XLSX-S2" prints as "XLSX-S"); not compared with Excel itself. |
| F8 | Low | OCR confuses 0/O in IDs ("SCAN-LO1"); 22 of 24 line IDs recognised, but it runs on the already auto-cropped page (see F1: "...by 30 N"). |

Good news (verified): Protect PDF keeps text and vectors exactly (3252/3252 chars, 10/10 vector ops); Compress PDF keeps text and vectors
and only recompresses pictures (scan 1654x2339 to 1556x2200); Word to PDF keeps the 1600x1200 photo at 320 dpi (Word itself reduces it to 999x749); Excel to PDF keeps values,
formula results and the merged heading as selectable text; PDF to Excel recovers all 12 numbers; PDF to Word on a scanned PDF recovers all 4 sampled lines;
the upload path's own JPEG re-encode (q0.92) is visually lossless (43.6 to 58.5 dB PSNR); a 48 MP JPEG is handled in 2.2 s with a 60 MB heap; a 45 MB PNG is refused with a clear message.

## 2. Workflow inventory (verified from `utils/tools/registry.ts`, `components/convert/tools.ts`, the code)

| Workflow | Exists | Pipeline summary | Exercised |
|---|---|---|---|
| Scan (camera) | yes | frame -> canvas -> JPEG 0.92 (cap 4096 px) -> detect/crop -> page image -> jsPDF A4 | not run (needs a camera); same code as upload |
| Upload photo / Image to PDF | yes | decode -> canvas -> JPEG 0.92 -> auto-crop -> JPEG 0.92 -> jsPDF A4 | yes |
| PDF import / Edit PDF / sign / annotate / add text / highlight | yes | pdf.js -> 2000 px JPEG 0.85 per page -> edits -> flatten -> A4 | yes |
| Add image (picture, passport photo, logo, signature) | yes | original kept, layered export | yes (earlier commits' tests) |
| Rotate / crop / brightness / contrast / enhancement | yes | re-render from the original, JPEG 0.92, cap 4096 | rotate only; enhancement modes NOT TESTED |
| Merge PDFs | yes (multi-upload, reorder) | same as Edit PDF | yes |
| Split PDF | no dedicated tool (remove pages then create) | same as Edit PDF | not separately |
| Word to PDF | yes (.docx only) | custom layout engine -> jsPDF text | yes |
| Excel to PDF | yes (.xlsx/.xlsm/.csv) | ExcelJS -> jsPDF text | yes (no chart: none could be generated) |
| PDF to Word | yes | pdf.js text -> rebuilt DOCX; OCR for scans | yes |
| PDF to Excel | yes | pdf.js text -> table detection -> XLSX | yes |
| Compress PDF / image / Word / Excel | yes | PDF: structural + picture recompression, flatten only at strong levels | PDF, image yes; Word/Excel NOT TESTED here |
| Protect PDF (Word/Excel/PowerPoint behind a flag) | yes | qpdf WASM | PDF yes; Office NOT TESTED |
| OCR / text export (TXT, DOCX, XLSX, CSV) | yes | tesseract.js | TXT yes |
| Print / download | yes | same page images | yes |
| PDF to image, PDF to JPG/PNG | **not supported** | - | - |

## 3. Test files (all synthetic, `node tests/audit/make-corpus.mjs`)

`photo-hi.jpg` 4000x3000 (4.7 MB), `photo-std.jpg` 1600x1200, `photo-low.jpg` 400x300, `photo-large.jpg` 8000x6000 (11 MB), `photo-large.png` (45 MB),
`logo.png` 1200x1200 transparent, `signature.png` 900x300 transparent, `text.pdf` (3 A4 pages, 6-12 pt text, hairline table),
`vector.pdf` (Letter portrait with hairlines, circles, embedded photo + landscape page), `scan.jpg` / `scan.pdf` (A4 @ 200 dpi text),
`table.pdf`, `document.docx` (30 paragraphs, heading, 4x3 table, 1600x1200 photo, page break, accents), `workbook.xlsx` (formats, formulas, merged cell, 2 sheets).
No chart fixture: no available library can create one, so charts are NOT TESTED.

## 4. Measurements (input vs the real downloaded file)

| Feature | Input | Output | Result |
|---|---|---|---|
| Scan upload | photo-hi.jpg 4000x3000 | PDF | embedded **4000x1262** (should be 4000x3000): cropped; drawn 210x66 mm |
| Scan upload | photo-std.jpg 1600x1200 | PDF | embedded **1600x505**: face cropped out (see `visual-crop.png`) |
| Scan upload | scan.jpg 1654x2339 | PDF | embedded **671x1801**; right ends of text lines cut; OCR then reads "by 30 N" |
| Scan upload | logo.png / signature.png | PDF | JPEG, no alpha; transparent areas **black**; logo also cropped to 793x832 |
| Scan upload, crop reset | photo-hi / std / low / scan | PDF | 4000x3000 / 1600x1200 / 400x300 / 1654x2339 at 484 / 194 / 48 / 200 dpi; PSNR 43.6 / 47.6 / 47.0 / 58.5 dB; original bytes **not** kept (re-encoded q0.92) |
| Scan upload, crop reset | logo.png | PDF | PSNR **1.9 dB**: transparency lost |
| Stress | photo-large.jpg 48 MP | PDF | embedded 4096x1292 (capped and cropped), 2.2 s, heap 60 MB |
| Limit | photo-large.png 45 MB | rejected | "That file is too large. Please use an image under 25MB." |
| Edit PDF | text.pdf (3 p, 9,758 chars, vector) | PDF 1,235 KB | text **0** chars, markers 0/4, vector ops 0, page image 1414x2000 @ 171 dpi |
| Edit PDF | vector.pdf (Letter + landscape) | PDF | text 0, vector 0; p1 now A4 (image 210x271.8 mm), p2 **A4 portrait** with image 210x162.2 mm |
| Edit PDF | scan.pdf | PDF | 1414x2000 @ 171 dpi (source 200 dpi), detail 91% of source |
| Combine | text.pdf + vector.pdf | PDF | 5 pages, correct order, all A4 portrait |
| Rotate | photo-std.jpg | PDF | 505x1600 (crop applied too) |
| Word to PDF | document.docx | PDF | 3 pages (Word: 2); text 3242 chars; **table text missing** (TBL-R0C0, TBL-R3C2 absent); photo 1600x1200 @ 320 dpi; see `out-word.pdf-p1.png` vs `out-word-reference-p1.png` |
| Excel to PDF | workbook.xlsx | PDF | 2 pages; values and formula results printed (grand total 7316.4); second sheet cells clipped |
| PDF to Word | text.pdf | DOCX | 4/4 markers, 149 paragraphs, 36 headings (misclassified), 0 tables, 0 pictures |
| PDF to Word | scan.pdf (OCR) | DOCX | 4/4 markers, 1,270 chars |
| PDF to Excel | table.pdf | XLSX | 12/12 numbers as numbers, header correct |
| Compress PDF | text.pdf / vector.pdf / scan.pdf | PDF | original returned (no gain) / 497 to 201 KB, text+vector intact / 225 to 166 KB, 1556x2200 |
| Compress image | photo-hi.jpg | JPEG | 3000x2250, 4705 to 801 KB (level default, documented) |
| Protect PDF | text.pdf / vector.pdf | PDF | needs password; text 3252/3252, vector 10/10 and 74/74 preserved |
| OCR | scan.jpg | TXT | 22/24 line IDs, 8/8 key words, 3 s |
| Print | text.pdf | printed PDF | text 0 chars, 1414x2000 @ 181 dpi (same pictures as the download) |

## 5. Findings table

### F1 Auto-crop destroys content of uploaded images (verified, Critical)
- **Input/Output**: any JPEG/PNG upload to Scan or Image to PDF -> PDF.
- **Root cause**: `components/scanner/ScannerWorkspace.tsx:80` (`AUTO_CROP_CONFIDENCE_THRESHOLD = 0.55`) and `:183` (`cropEnabled = confidence >= ...`) turn the detected quad into a crop for *every* uploaded image (`runDetectionAndRender`, called from `importDocument`), not only camera captures; detection in `utils/scanner/detection.ts` takes the edge hull of any image.
- **Evidence**: embedded 4000x1262 / 1600x505 / 671x1801 / 793x832; `tests/audit/visual-crop.png`; with "Reset to original" the same files export at full size.
- **User impact**: a user converting a photo or an already-clean page to PDF gets a cropped, sometimes unusable result, and the UI only says "Cropped".
- **Fix**: crop automatically only for camera captures; for uploads default `cropEnabled=false` and offer a one-tap "Auto-crop" suggestion; additionally require the quad to cover a plausible document (area ratio, 4 near-right angles, edge contrast against the border).
- **Regression risk**: the camera scanning flow and OCR input (OCR currently benefits from tight crops).
- **Verification**: upload each corpus image, export, assert embedded dimensions equal the source (uncropped) and that a camera-style capture still crops.

### F2 Transparent PNG flattened to black (verified, Critical)
- **Root cause**: `utils/scanner/image.ts:41` draws the image on a canvas with no background fill and `toDataURL("image/jpeg", 0.92)`; transparent pixels encode as black.
- **Evidence**: PSNR 1.9 dB, embedded `/DCTDecode`, `alpha=false`, black inside the rings.
- **Fix**: fill white before drawing (minimum) or keep PNG when the image has alpha and place it with transparency (as the Add image tool already does).
- **Risk**: low; page processing re-renders from this original.
- **Verification**: logo.png and signature.png export with a white (or transparent) background.

### F3 PDF editing rasterizes the whole PDF (verified, High)
- **Root cause**: `utils/scanner/pdfImport.ts` (`TARGET_LONG_SIDE_PX = 2000`) + `utils/pdf/render.ts` (`jpegQuality = 0.85`) turn each page into a picture; `utils/scanner/pdf.ts` rebuilds the PDF from pictures. The UI states "existing text is not editable" but not that selectable text and vectors are lost.
- **Evidence**: text chars 9,758 -> 0; vector ops 10 -> 0 and 74 -> 0; 5 KB -> 1,235 KB; 171 dpi.
- **Impact**: searchable, copyable, crisp-at-any-zoom PDFs become soft pictures that cannot be searched.
- **Fix (smallest)**: warn in the UI and raise the import resolution (about 3000-3500 px, memory permitting). **Proper fix**: for annotation-only edits and page reorder/remove/rotate, apply them to the original PDF with `pdf-lib` (copy pages, draw overlays as vector/image layers) and rasterize only pages the user crops or enhances.
- **Risk**: highest of all fixes: touches import, page model, annotations flatten and print.
- **Verification**: text and vector counts preserved after sign / add text; page sizes unchanged.

### F4 Page size and orientation forced to A4 portrait (verified, High)
- **Root cause**: `utils/scanner/pdf.ts:20` (`format: "a4"`) and `:26` (`doc.addPage()` without size or orientation).
- **Evidence**: vector.pdf page 2 (landscape Letter) exported as A4 portrait with the picture 210x162.2 mm; page 1 Letter becomes A4.
- **Fix**: size each page from its own aspect (`widthPt/heightPt` for imported PDFs; choose orientation from the image aspect for photos).
- **Risk**: print layout (`widthPt` handling) and the physical-size presets (they assume the A4 fit).
- **Verification**: output page sizes equal input for Letter, A4, landscape.

### F5 Word to PDF table widths (verified vs Word, High for affected documents)
- **Root cause**: `utils/convert/docx/model.ts:867-868` reads `tblGrid/gridCol` and the layout (`flow.ts`) uses that grid as the column widths; Word uses cell widths (`tcW`) when the table autofits. The docx.js library writes `gridCol w=100` unless widths are passed, and other generators do the same.
- **Evidence**: `out-word.pdf-p1.png` (collapsed table) vs `out-word-reference-p1.png` (Word's own export): Word fits the document in 2 pages, ours produced 3.
- **Fix**: when the grid disagrees with `tcW` (or is implausibly small), derive column widths from `tcW`, then autofit.
- **Risk**: the calibrated layout rules (`npm run test:docx` fidelity suite).
- **Verification**: this fixture against Word's export, plus the existing fidelity suite.

### F6-F8 (medium/low)
- **F6** `utils/convert/pdfToWord.ts` / `pdfLayout.ts`: heading rule tags 12 pt body lines as headings; hairline tables not detected. Fix: require size jump and bold/short line; detect line-ruled tables.
- **F7** `utils/convert/excelToPdf.ts`: text clipped to column width where Excel would show it; compare with Excel before changing.
- **F8** OCR digit/letter confusion; mitigated by fixing F1 and offering OCR on the uncropped original.

## 6. Tests

Commands run (all against `next start` on port 3117):
`node tests/audit/make-corpus.mjs`, `node tests/audit/audit-scan.mjs`, `node tests/audit/audit-convert.mjs`, `node tests/audit/audit-misc.mjs`, `node tests/audit/audit-genloss.mjs`, `node tests/audit/visual-crop.mjs`, `node tests/audit/visual-text.mjs`, `node tests/audit/word-ref.mjs` (Word 2-page reference made with Word COM).
Existing suites: `test:pdf2excel` 7 pass / 0 fail; `test:docx:robust` 12 / 0; `test:compress` 38 / 0; `test:protect` 1 failure: the policy test's regex expects `\n` line endings but `utils/tools/registry.ts` is checked out with CRLF on Windows (pre-existing, unrelated to quality; the encryption tests themselves pass).
Earlier base-commit comparison (zoom, theme, print, consent) stands: all failures there pre-date the image commits.

## 7. Not tested / inconclusive

Camera capture (no camera); enhancement modes (Auto, Grayscale, Black and White); Word and Excel compression; Office protection (behind a flag); XLSX charts (no fixture);
DOCX with Word-authored tables (existing `test:docx` compare suite not run here); Excel's own PDF export for comparison; a real phone photo (all photos here are synthetic);
iOS/Safari memory behaviour; color accuracy (ICC) of images.

## 8. Quality-preservation strategy

Keep the source whenever possible (as Add image now does); do not rasterize PDFs unless the operation needs pixels (crop, enhance, OCR) - overlay edits onto the original PDF instead;
auto-crop only where document detection is the purpose (camera); never convert alpha to black; keep each page's own size and orientation; keep preview resolution independent of export
resolution (Add image proves the pattern); where a conversion is necessarily lossy (PDF to Word layout, Excel clipping), say so next to the Download button. Per-format settings, not one global resolution.

## 9. Proposed implementation order

1. F1 (stop auto-cropping uploads) and F2 (white fill / keep alpha): small, high impact.
2. F4 (per-page size and orientation).
3. F5 (Word table widths) with Word-reference tests.
4. F3 staged: UI warning + higher import resolution first, then original-PDF overlay editing.
5. F6-F8.

## 10. Resolution status (fixes made after this audit, local commits on `web-only`)

| Finding | Status | How it was verified (real downloaded PDFs) |
|---|---|---|
| F1 auto-crop of uploads | Fixed: uploads are never cropped without consent; detection is a "Suggested crop" card | `npm run test:quality-fixes`: 8 images export at full size (3000x4000, 4000x3000, 1654x2339 ...), corner markers intact, suggested crop still crops on request, manual crop editor opens |
| F2 transparency to black | Fixed for scanner pages: flattened onto white and the person is told; Add image keeps real transparency | 4 transparent fixtures: 0 black pixels where the source was transparent (was 100%), colour difference 0.4-8; opaque PNG/JPEG unchanged (PSNR 47-48 dB) |
| F4 page size/orientation | Fixed: PDF pages keep size and orientation; pictures get A4 portrait or landscape | A4 P/L, Letter, mixed 4-page file: sizes equal the input (Letter 215.9x279.4 mm); landscape photo 297x198 mm on an A4 landscape sheet |
| F5 Word table widths | Fixed: a placeholder grid is replaced by the cells' own widths | 5 fixtures vs Word's own PDF: column positions within 0.1 pt, equal page counts; `npm run test:docx:tables` |
| F3 PDF edit rasterizes everything | Fixed for pages whose pixels are not edited: original page re-embedded, additions drawn as real PDF content | `npm run test:pdf-edit`: text 1029/1029 chars + added text selectable, vector ops 54 (source 50), photo bytes identical, page order/rotation correct; text.pdf 9758 -> 9758 chars (was 0) |
| F6-F8 | Not changed | - |

Remaining limits of F3: a page that is cropped or enhanced (Auto, Grayscale, Black and White, brightness, contrast) is still exported as a picture (at its true physical size); links, form fields and bookmarks of an edited PDF page are not carried over; text the standard fonts cannot write (other alphabets, emoji) is added as a picture; the Print button still prints page pictures (about 170 dpi).


## 11. Final assessment (after Phases 6-10; final production build, 2026-10-17)

How to read the evidence: **downloaded file** = the real file the browser saved, opened and measured; **print PDF** = Chromium's own print output saved as PDF; code reading alone is never counted as verified.

| Workflow | Fixture and route | Before (audit) | After (measured on the downloaded file) | Visual check | Tests (actual) | Remaining limits | Status |
|---|---|---|---|---|---|---|---|
| Upload photo / image to PDF | photo-hi/std/low, portrait, landscape, scan.jpg via /scan | cropped (4000x1262 from 4000x3000, face cut out) | exported at full size (3000x4000, 4000x3000, 1654x2339 ...), corners intact; the suggested crop is opt-in | viewed | `test:quality-fixes` 23/23 | the camera path (still auto-crops) was not run: no camera; the suggested crop itself can be poor on some pages | **Fixed** (camera untested) |
| Transparent PNG upload | logo, soft logo, 2 signatures | transparent areas black (1.9 dB) | 0 black pixels where transparent, colours within 0.4-8, notice shown; opaque PNG/JPEG unchanged (47-48 dB) | viewed | `test:quality-fixes` | scanner pages are opaque JPEG by design; Add image keeps real transparency | **Fixed** (flattened onto white by design) |
| Page size and orientation | a4-portrait, a4-landscape, letter, mixed 4 pages, landscape and portrait photos | everything A4 portrait (landscape became a 210x162 mm strip) | sizes equal the input (Letter 215.9x279.4, landscape 297x210, mixed order kept); photos get an A4 sheet in their own orientation, not stretched | measured | `test:quality-fixes`, `test:images` 15/15 | print margins unchanged by design | **Fixed** |
| Edit PDF (sign, text, marks, pictures, reorder, rotate) | rich.pdf (text, 6 pt, vectors, 1600x1200 photo, landscape page) through the real editor | text 9758 -> 0 chars, vector 74 -> 0, 171 dpi pictures | original text kept (1029/1029 on page 1, added text selectable), vector ops 54 (source 50), photo bytes identical at 407 dpi, order and rotation correct, additions where placed | rendered and viewed | `test:pdf-edit` 11/11 | cropped or enhanced pages become pictures; links and forms of an edited page dropped; text outside Latin-1 added as a picture | **Fixed for pages without pixel edits; partial for crop/enhance** |
| Add image | passport photo 35x45 mm, logo, signature, low-res, large | (earlier work) | 35.00x45.00 mm in the download; 3000x3857 embedded; logo 1200x1200 with alpha; 6000x4500 capped to 4000x3000 | viewed | `test:images:e2e` 27/27, `test:images:quality` 11/11 | direct Print fits to paper (about 94.5%: 33.06x42.50 mm) | **Fixed** |
| Print | rich.pdf, mixed portrait/landscape, inserted logo, Chromium print to A4 | page pictures 1414x2000 at 181 dpi | 2481x3509 at 318 dpi, order and orientation kept, inserted logo 1200x1200 with alpha, 6 pt caption and photo stripes crisp | cropped and viewed | `test:print-quality` 3/3, `test:images:quality` | printed pages are still pictures (text not selectable; the PDF download is the vector one); about 1.1 MB per 3 pages; margins and fit-to-paper unchanged | **Partially fixed** (sharper, not vector) |
| Word to PDF | document.docx (30 paragraphs, 4x3 table, photo, page break, accents) and 5 table fixtures | table collapsed to 1.8 mm columns, 3 pages vs Word's 2, 8/10 markers | 2 pages, 10/10 markers, photo 1600x1200 at 320 dpi; fixtures' column gaps within 0.1 pt of Word's PDF, equal page counts | compared with Word's own export | `test:docx:tables` 9/9, `test:docx:robust` 12/12 | `test:docx` compare: 2 variants (04-tables, 05-images) differ from Word, identical on the clean base | **Fixed** (2 older differences pre-existing) |
| Excel to PDF | clipping.xlsx (134 values, fonts, widths, formulas, 3 sheets) and workbook.xlsx | 17 of 134 values clipped (Referen, SHEET2, Calibri 1) | 0 of 134 clipped; spill preserved; order and A4 portrait/landscape kept | viewed | `test:excel-pdf` 5/5 | charts NOT TESTED (no fixture can be created); Excel's own PDF not compared; a long value in a narrow column with an occupied neighbour is cut, as in Excel | **Fixed** (charts untested) |
| PDF to Word | report.pdf (title, 2 subheadings, lead paragraph, ruled and borderless tables, list) and text.pdf | 36 of 149 paragraphs as headings | report: exactly 3 headings, both tables with all values, 3 list items, 100% word recall in source order; text.pdf: 3 headings (its 3 titles), 144 paragraphs | DOCX structure inspected | `test:pdf-word` 9/9 | complex layouts (columns, wrapped pictures) still change; pictures not copied (stated in the UI); the audit's "0 tables" came from a fixture with no cell text | **Fixed for the cases tested; limits unchanged** |
| PDF to Excel | table.pdf | 12/12 numbers | unchanged 12/12 | - | `test:pdf2excel` 7/7 + 11/11 | works best on selectable-text tables | **No defect found** |
| OCR | scan.jpg (22 px and 30 px text), 5 fonts x 3 qualities x 3 sizes | "SCAN-LO1" (0 read as O) | engine settings do not help (upscaling +0.2 points; DPI, dictionary, page mode no effect); optional explicit code-format control: 99.69% -> 99.85%, 0->O swaps 2 -> 0, ordinary text untouched | panel used in the browser | `test:ocr` 7/7, `test:ocr:ui` 6/6, `tests/ocr/accuracy.mjs` | the engine still reads O/0 and 1/I/l from context (a real letter O among digits becomes 0; inserted characters like LO03 cannot be fixed); in these fixtures the errors depend on the model, not on image quality, size or font | **Partially fixed** (documented; explicit opt-in only) |
| Compress PDF / image | text, vector and scan PDFs; photo-hi.jpg | - | text and vectors preserved; scan 1654x2339 -> 1556x2200; image 4000x3000 -> 3000x2250 (documented level) | - | `test:compress` 38/38 | Word/Excel compression NOT TESTED here | **No defect found** |
| Protect PDF | text.pdf, vector.pdf | - | needs the password; text 3252/3252 and vector ops preserved | - | `test:protect`: encryption tests pass; 1 policy test fails (CRLF regex) | Office protection (behind a flag) NOT TESTED | **No defect found** (1 pre-existing harness failure) |
| Combine / reorder PDFs | text.pdf + vector.pdf; rich.pdf reorder | - | 5 pages, correct order and sizes | - | `test:pdf-edit` | - | **Works** |

### Test results on the final build (exact)
Type check clean; lint 0 errors (17 existing warnings); production build succeeds.

Passing: `test:quality-fixes` 23, `test:pdf-edit` 11, `test:print-quality` 3 (+ measurements), `test:excel-pdf` 5, `test:pdf-word` 9, `test:ocr` 7, `test:ocr:ui` 6, `test:docx:tables` 9, `test:images` 15 + 4, `test:images:e2e` 27, `test:images:quality` 11, assistant unit 19 + 17, assistant browser 31, launcher 16, `test:pdf2excel` 11 + 7, `test:compress` 38, `test:docx:robust` 12.

Failing, with failure sets identical to the documented ones on the clean base commit: zoom 4 passed / 14 failed, theme 21 / 1, print 27 / 6, consent 65 / 1, `test:protect` 1 (policy regex vs CRLF), `test:docx` 2 variants (04-tables, 05-images). None was introduced by these fixes. Causes: the cookie banner is the last `[role=dialog]` and gates analytics (zoom, theme, print), and a Windows path or line-ending assumption (consent, protect).

### Remaining defects, ranked
1. **Edit PDF, cropped or enhanced pages (medium-high):** exported as pictures at true size; text and vectors of those pages are lost. Fixing it needs vector clipping for crop and a raster-only path for enhancement.
2. **Print is raster (medium):** sharper (318 dpi) but not selectable text, because the browser print layer takes images. Use the downloaded PDF for vector output.
3. **Direct print scales to the paper (medium):** a 35 mm photo prints about 33 mm, and the UI says so. Margins were deliberately not changed globally.
4. **OCR O/0 and I/1/l ambiguity (low-medium):** engine-limited; opt-in format control only for codes of a known shape.
5. **Camera auto-crop and suggested-crop quality (low-medium, untested):** the suggestion can cut text on some pages; the camera path was not run.
6. **PDF to Word complex layouts (low):** columns and wrapped pictures change; stated in the UI.
7. **Not tested:** XLSX charts, Word/Excel compression, Office-file protection, enhancement modes other than Grayscale, a real phone photograph, Safari/iOS memory behaviour.


## 12. Cropping and enhancing imported PDF pages (2026-10-17)

Question: can a page of an imported PDF be cropped or enhanced without becoming a picture? Answer, operation by operation, with the reason and the measurement.

### What can stay vector, and what cannot

| Operation | Result | Why |
|---|---|---|
| Rotate | Vector (already) | a page rotation is a transform |
| **Rectangle crop** | **Vector (new)** | the crop rectangle is mapped from the page picture back to the PDF page's own coordinates (through the page's own `/Rotate`) and applied as the clip box of the embedded page; text, vector drawing and embedded photographs are untouched |
| Skewed (perspective) crop | Picture | straightening a slanted quad is a pixel warp. It cannot occur on an imported PDF page any more: the crop editor now keeps a PDF page's crop a rectangle (dragging a corner moves the two sides it touches) |
| Crop with "Remove the cut-away area for good" | Picture, by choice | a clip box only hides the area; the text and drawing outside it stay inside the file. The editor says so and offers this option for private details |
| Grayscale, Black and White, Auto | Picture | they change the colour of the artwork (text, vectors and photographs alike). See the overlay experiment below |
| Brightness, contrast | Picture | the editor's curve (contrast pivoting on mid-grey, then an offset) has no PDF equivalent that works for text, vectors and photographs together |
| Added text, marks, pen, pictures, signatures | Vector (already) | drawn as real PDF content |

**Overlay experiment (Grayscale).** A full-page rectangle with the PDF *Saturation* blend mode and a grey fill should desaturate the page without touching it. I built that PDF (red and blue squares under the overlay) and rendered it with pdf.js: both squares came out as flat grey 128,128,128 (the colour of the overlay itself, not the grey of the artwork underneath, which would be about 87 and 78). A viewer that does not implement the non-separable blend modes correctly would therefore show a solid grey page. Even where it works, the file would still hold the colour data, so it would not be smaller or truly grey. Rejected as not reliable. Brightness and contrast cannot be reproduced by a blend either (a white or black overlay mixes towards a colour, the editor's curve stretches).

### What was changed

- `utils/scanner/cropMath.ts` (new, pure): rectangle detection, picture-crop to PDF-box conversion for `/Rotate` 0/90/180/270, and `flattenReason` (the single rule for "does this page keep its text").
- `utils/scanner/pdfExport.ts`: `canPreserveSource` uses that rule; a rectangle crop embeds the page with the cropped bounding box, then rotation and annotations are applied as before.
- `utils/scanner/sourceRender.ts` (new): pages that must be pictures are now drawn again from the ORIGINAL PDF at 300 dpi (capped at 6000 px on the long side; processing still caps at 4096 px) and the same crop and enhancement are applied to that sharper picture, instead of enlarging the 170 dpi on-screen picture. Used by the PDF export (`pdf.ts`) and by printing (`utils/print/sources.ts`). If anything fails the page is exported as before. The on-screen page, the original and every setting are untouched, so each edit stays reversible.
- `components/scanner/CropEditor.tsx`: rectangle crop for PDF pages, a short explanation, and the "Remove the cut-away area for good" option (`page.cropPermanent`).
- `components/scanner/FlattenNotice.tsx` (new), shown in the page editor and next to the selected page: says whether the page keeps its selectable text and, when an edit prevents it, which edit and what to do to keep the text.

### Measured on the downloaded PDFs (`npm run test:pdf-quality`; rich.pdf: A4 portrait, A4 landscape, A4 portrait; selectable text, 6 pt text, hairlines and circles, one 1600x1200 photo)

| Case | Result |
|---|---|
| Rectangle crop 16-84% x 11-79% of page 1 | page size 142.8x202.0 mm (expected 142.8x202.0); 16 of 16 text operations in the file; 734 of 1029 characters selectable (the rest lies outside the crop and pdf.js leaves out glyphs that are not visible); 50 path operations (source 50); photo bytes identical, 407 dpi (source 407); rendered result vs the same region of the source: identical (PSNR 99 dB) |
| `/Rotate` 90, 180, 270 pages, cropped differently | rendered crop equals the same region of the source: 76.6, 99, 75.3 dB; text operations 2 of 2; path operations 14 |
| Crop then rotate right (page 3) | 231.7x163.8 mm (swapped as expected); 930 characters selectable; PSNR vs the expected pixels 70.9 dB |
| Grayscale on the landscape page | a picture, 3508x2480 px at **300 dpi** (the same export was about 170 dpi before this change), 297x210 mm |
| Grayscale on the coloured page 1 | colour (mean channel difference) 5.1 -> 0.00; mean luminance within 1.5 of the source; 300 dpi |
| Black and White on page 1 | 2481x3509 px at 300 dpi; 95.9% of pixels pure black or white; no colour |
| Brightness -40 and contrast +25 on page 2 | 300 dpi; matches the editor's own curve applied to the unadjusted picture (PSNR 38.5 dB; an unadjusted page would be 23.5 dB); mean luminance 253.3 -> 236.2 |
| "Remove the cut-away area for good" | a picture at 300 dpi, 231.7x163.8 mm, no text left in the file |
| Untouched page 3 combined with edited pages | 1059 of 1059 characters, same path operations, PSNR 99 dB |
| Reverting: crop + Grayscale, then Reset to original | page is A4 again, 1059 of 1059 characters, PSNR 99 dB; no notice shown |
| Page order and sizes across all exports | as expected; every file reopens |

### Remaining limitations

- Grayscale, Black and White, Auto, brightness and contrast still make the page a picture (now at 300 dpi). The editor says so before and after the edit. **Auto** was not run through the browser; it takes the same code path as Grayscale.
- A rectangle crop only hides the cut-away area: the text and drawing there remain in the PDF (all 16 text operations were still present after the crop). The editor says so and offers "Remove the cut-away area for good".
- On a very large page the 300 dpi render is capped by memory (6000 px, then 4096 px after processing), so the dpi is lower there.
- A page that came from a PDF and is exported as a picture is drawn by pdf.js, which can differ slightly from other viewers in font substitution.
- pdf.js in Node (used by the tests) draws the vector source with substitute fonts and thicker hairlines than Chrome does, so raster-versus-source comparisons use pages exported through the same browser pipeline, or measure statistics (colour, luminance) instead of per-pixel PSNR.
- Not tested: PDFs with encryption, form fields or links on a cropped page (these are not carried over, as for any edited page); a real phone; Safari.

### Test results for this change (production build; exact)
Type check clean; lint 0 errors (17 existing warnings); production build succeeds.

Passing: `test:pdf-quality` 18 (crop geometry) + 18 (downloaded PDFs), `test:pdf-edit` 11, `test:quality-fixes` 23, `test:print-quality` 3, `test:images` 15 + 4, `test:images:e2e` 27, `test:images:quality` 11, `test:compress` 38, assistant launcher 16, assistant browser 31, `test:install:browser` 56.

Failing with the same sets as on the clean base commit (documented in section 11): zoom 4 passed / 14 failed, theme 21 / 1, consent 65 / 1.


## 13. Auto enhancement verified in the browser, and the final status of the PDF limitation (2026-10-18)

Auto was exercised through the real UI on its own (`node tests/audit/verify-pdf-auto.mjs`, 13 checks), not inferred from Grayscale.

### A defect found by this test, and fixed
Auto (and Black & White) choose their levels from the picture they are given (Auto stretches between the 1% darkest and lightest grey levels; Black & White uses Otsu's threshold). The export draws an imported page again at 300 dpi, where hairlines and small text weigh differently in the histogram, so **the exported Auto tones differed from the editor's preview**: photo-area tones (5 / 50 / 95 percent) were 70 / 154 / 184 in the preview and 97 / 161 / 191 in the export (lighter, flatter).

Fix: `utils/scanner/enhance.ts` can now report the levels it used and accept them (`EnhancementParams`); `utils/scanner/sourceRender.ts` first renders the on-screen picture to get those levels and applies them to the 300 dpi render. After the fix the same measurement gives 70 / 154 / 184 against 80 / 152 / 185 (the 5% tail differs by 10 because the photo's fine stripes alias differently when shrunk; the middle and light tones are within 8). Printing uses the same code, so it gets the same correction. Pages that were not enhanced are unchanged.

### Measurements on the downloaded PDFs (rich.pdf: A4 portrait, A4 landscape, A4 portrait)
| Item | Result |
|---|---|
| Auto on page 1 | a picture of 2481x3509 px filling 210x297 mm: **300 dpi** (the editor's own picture is 1414x2000 = 171 dpi); no colour (chroma 0.00) |
| Page sizes, orientation, order | 210x297 portrait, 297x210 landscape, 210x297 portrait; order kept |
| Against the editor's Auto preview, same pixel size | photo tones as above; white point 255 vs 255; mean brightness within 0.45; text ink: mean 227.79 vs 228.32, dark pixels 10.33% vs 10.32% |
| Clarity | at 4x the photo area has detail 26.05 vs 16.29 for the on-screen picture enlarged; text grey-edge share 0.459 vs 0.653 (lower is crisper) |
| Readability | OCR of the downloaded page reads 7 of 7 sample words, including the title, body lines and the 6 pt caption |
| Untouched pages beside an Auto page | page 2 text 71/71 characters, 9/9 vector operations; page 3 text 1059/1059 |
| Auto on the landscape page 2 | 3508x2480 px at 300 dpi, 297x210 mm; page 1 keeps 1029/1029 characters, 50/50 vector operations and the 1600x1200 photo (407 dpi, identical bytes); page 3 keeps its text |
| Reset to original after Auto (page 2) | text 71/71 (6 pt text selectable again), 9/9 vector operations, 297x210 mm, PSNR vs source 99 dB |
| Repeated adjustments (8 mode changes, 5 slider moves, rotate right and left, ending in Auto) | identical to a single Auto export (PSNR 99 dB), 300 dpi: the stored source does not degrade, because every render starts from the untouched original |
| Black & White vs its preview | agrees (the photo area is solid black in both with this fixture, so this shows agreement, not sensitivity) |

Per-pixel comparison of text and hairlines against the preview is not meaningful (PSNR was about 20 dB although the ink density matched to 0.01%), so text is judged by ink density, edge crispness and OCR. The 0.25 pt vertical lines are drawn slightly darker at screen size than at 300 dpi (dark-pixel share 7.9% vs 4.5% in that strip); the export is the truer one.

### The warning
Before anything is applied the page editor says (for PDF pages): "Grayscale, Black & White, Auto, brightness and contrast change the colours of the page itself. Only this page then becomes a picture in the exported PDF (its text can no longer be selected); your other pages keep theirs. Reset to original brings it back." After choosing Auto it says Auto changes the colours of the page itself, the page becomes a picture drawn from the original at about 300 dpi (lower on very large pages), its text and lines can no longer be selected or searched, and the other pages are not affected. The same notice is shown beside the selected page. Both are checked in the browser, including that neither implies the whole document is flattened.

### Decision on scope for this release
Rasterization is accepted for the pixel-based effects (Auto, Grayscale, Black & White, brightness, contrast, "remove for good" crop) because every condition is measured: the result is clear at its physical size (300 dpi, crisper than the on-screen picture, OCR reads it), the resolution limit is stated, untouched pages keep text, vectors and photographs byte for byte, Reset restores the source, and the person is told about the loss of selectability. No application-wide PDF graphics rewrite was attempted.

Possible future work (not done, not required): (1) a real PDF colour-space rewrite for Grayscale only, which needs content-stream, image and shading handling and validation across viewers (the blend-mode overlay was measured and rejected); (2) an optional lower dpi for smaller files; (3) per-pixel checks against browser-drawn references instead of Node's pdf.js.

### Final test results (production build; exact)
Type check clean; lint 0 errors (17 existing warnings); production build succeeds.

**Ran and passed:** crop geometry 18; `verify-pdf-quality` 18; `verify-pdf-auto` 13; `test:pdf-edit` 11; `test:quality-fixes` 23; `test:print-quality` 3; install unit 71, install browser 56, install final verification 35 PASS / 0 FAIL / 3 NOT TESTED; assistant unit 19 + 17, assistant browser 31, launcher 16; `test:images` 15 + 4, e2e 27, quality 11; `test:compress` 38; Excel to PDF 5; PDF to Word 8 + 9; PDF to Excel 11 + 7; DOCX tables 9; DOCX robust 12; OCR 7 + UI 6.

**Known failures, identical to the clean base commit (section 11):** zoom 4 passed / 14 failed; theme 21 / 1; print 27 / 6; consent 65 / 1. (`test:protect` and `test:docx` were not re-run in this pass; their documented failures are unchanged.)

**Untested:** a real phone photograph, Safari/iOS, XLSX charts, Word/Excel compression, Office-file protection, the camera auto-crop path, PDFs with encryption, form fields or links on an edited page, and the real native install flow (see tests/install/INSTALL-VERIFICATION.md).

**Known product limitations:** Auto, Grayscale, Black & White, brightness and contrast make that one page a picture (300 dpi, lower on very large pages); a rectangle crop only hides the cut-away area unless "remove for good" is chosen; links, form fields and bookmarks of an edited PDF page are not carried over; printing still sends page pictures to the browser's print layer (download the PDF for vector output); imported PDFs are limited to 50 pages.

### Status of the output-quality audit
The PDF-editing limitation is **accepted for this release with the conditions above met and verified**, and a related defect it exposed (Auto and Black & White tones differing between preview and export) is fixed. The remaining ranked defects are those in sections 11 and 12 (direct print scaling, OCR O/0 ambiguity, camera and suggested-crop quality, complex PDF-to-Word layouts) plus the untested items above. The audit is not claimed to be free of defects: its highest-priority document-quality issues are fixed or accepted, with measurements.


## 14. Camera capture and crop safety (2026-10-18)

All camera results below are **SIMULATED**: Chrome's fake video device played synthetic frames through the real getUserMedia, capture, detection, crop and export code. No physical phone or camera was used.

### The camera path, stage by stage, and what each can do to the picture
| Stage | What happens | Can it remove content, distort, lose resolution or change orientation? |
|---|---|---|
| Camera acquisition (`CameraCapture.tsx`) | asks for the rear camera at up to 4096x3072, then tops up to the sensor's best mode (long side at most 4096) | resolution depends on what the browser gives; nothing is removed |
| Frame capture (`image.ts`, `captureVideoFrame`) | the video frame is drawn at its own size (only shrunk above 4096 px, about 350 dpi on A4), filled white, encoded once as JPEG 0.92. This is the immutable original | one JPEG encode. Camera frames arrive upright. Uploaded photos are decoded by the browser, which applies the EXIF orientation: an EXIF-6 file of 1600x1200 stored pixels came out upright as 1200x1600 (tested) |
| Boundary detection (`detection.ts`) | works on a 500 px copy: takes the outline of every strong edge, and the four extreme points of that outline become the crop. Confidence comes only from how much of the frame the quad covers | **This is the stage that could remove content.** It has no evidence that the quad is the page edge. When a page fills the frame the quad is the bounds of the printing; for a photograph it is arbitrary; the four extreme points can cut wedges off a turned page; a page running off the frame is cut along a straight line |
| Crop (`pageProcessing.ts`, perspective warp) | output size = the quad's own edge lengths, so no enlarging or shrinking; capped at 4096 px | removes what lies outside the quad, by design; re-derived from the original each time |
| Enhancement / adjust / rotate | always recomputed from the untouched original | no cumulative loss (measured, below) |
| PDF export (`pdf.ts`) | scanner pictures have no physical size, so each is fitted, centred and never stretched on an A4 sheet matching its orientation; an unannotated page is embedded as the existing JPEG | effective dpi = picture pixels / sheet inches, which is a property of the camera, not a loss |
| Download | the saved blob | none |

### Defect found and fixed
Camera captures were cropped automatically whenever the detector's area-based confidence reached 0.55, without any check that the quad matched a real page edge.
Measured on the app's real detector with synthetic scenes of known page outlines and edge markers (`tests/scanner/detection-safety.mjs`):
- hand-made scenes (18): the old rule applied a damaging crop (page coverage under 97% or an edge marker lost) in **3** (a pale page on a white table, a white page on a near-white surface, a photograph);
- 80 random desk scenes (page size, turn, desk and paper brightness, shadows, lighting, pages running off the frame): the old rule cropped 55 and **9 of those were damaging**;
- the audit's own `scan.jpg`: the old rule would crop it and lose **2.66% of its ink** (the "cut off at the right edge" report); `photo-std.jpg` 3.32% and `photo-hi.jpg` 3.46%.

Fix (`utils/scanner/cropSafety.ts`, used by `detection.ts` and `ScannerWorkspace.tsx`): a camera crop is applied automatically only if, besides the confidence, the crop passes a **page-edge proof**: across each of its four sides there must be a consistent brightness step of at least 25 grey levels (page against surface), the same direction on all sides, with paper-like content inside; a side that lies on the frame itself removes nothing, but a corner touching the frame (page running off it) is not accepted. Everything else becomes the existing **Suggested crop** card (accept, Adjust crop, or Keep full image), exactly as for uploads. The original capture is never replaced. When a crop is applied automatically a card says "Cropped to the page edges", offers **Keep full image** and **Adjust crop**, and says nothing was deleted.

After the fix: hand-made scenes 0 of 18 damaging (still 10 auto-cropped: pages on a desk, rotated 5, 30 and -4 degrees, landscape and portrait, edge printing, shadows, a blurred frame, a black header band, a dark page); random scenes **0 of 80 damaging** (28 cropped automatically, the rest left to the person, which includes 18 of the 46 sound crops the old rule would have made: those now need one click); `scan.jpg` and both large photos are kept whole and only suggested.

### Measured end to end (simulated camera frames, real downloaded PDFs)
| Case | Result |
|---|---|
| Desk page, 5 degrees, auto-cropped | 210x297 mm portrait; picture 828x1032 px for a page that is 800x1000 px in the frame (no resolution lost; 1.2% safety margin); aspect 0.802 vs 0.800; 4 of 4 edge markers kept |
| After "Keep full image" | the whole capture again: 1600x1200 px on a 297x210 mm landscape sheet, 4 of 4 markers |
| Portrait frame, portrait page | portrait sheet, 827x1162 px for an 800x1130 page, 4 of 4 markers |
| Landscape page in a landscape frame | landscape sheet, 1220x859 px for a 1180x830 page, 4 of 4 markers |
| Photograph, pale-on-white page, page running off the frame, white-on-near-white page | no automatic crop; suggestion offered; export is the full 1600x1200 frame with every visible marker |
| Accept a suggestion / Adjust by hand / Keep full image / Reset to original | accepted crop exported (734x912), manual crop exported as set (575x931), kept-full exports 1600x1200, Reset restores 1600x1200 |
| 7 mode changes, 4 slider moves, two rotations, back to Original | equals the first export, PSNR 99.0 dB (the original does not degrade) |
| Three pages with three decisions (accepted 828x1032, kept full 1600x1200, adjusted 1320x1178) | each decision is in the export, order and orientations kept; changing page 3 left pages 1 and 2 equal in content (PSNR >= 45 dB) |
| EXIF-rotated photo (EXIF 6) | decoded upright, 1200x1600 px, portrait sheet |

Effective dpi in these runs is about 100 to 145 only because the synthetic frames are small (1200x1600 and 1600x1200). A 12 MP phone frame (4032x3024) fills an A4 page at about 350 dpi; nothing in the app lowers it (the long side is capped at 4096 px).

### Limitations
- The page-edge proof is a brightness-step rule, not geometry. It can still be fooled (for example a sharp lighting or shadow edge that is not the page edge, a dark page on a dark desk is refused but a sharp shadow line crossing a pale page is not specially detected). In 80 random scenes and 18 hand-made ones it never cut anything, but that is a synthetic sample, not a proof.
- It is conservative: pages with a weak edge, a pale desk or a bright surface now get a suggestion instead of an automatic crop.
- Receipts: detection still ignores objects under 15% of the frame; the receipt scene (22% wide) was detected only weakly (confidence 0.39), so no crop is offered. Capturing it manually keeps the whole frame.
- Orientation of a camera frame is whatever the browser delivers; an EXIF-rotated upload was verified in Chrome only.
- NOT TESTED: a real phone or webcam, Safari/iOS camera behaviour, very large sensors (above 4096 px they are downscaled), live camera guidance, and any lighting that the synthetic scenes do not model.

### Final test results (production build; exact)
Type check clean; lint 0 errors (17 existing warnings); production build succeeds.

**Ran and passed:** scanner detection safety (strict), camera browser 14, multi-page/EXIF 5; crop geometry 18; `verify-pdf-quality` 18; `verify-pdf-auto` 13; `test:pdf-edit` 11; `test:quality-fixes` 23; `test:print-quality` 3; install unit 71, install browser 56, install final 35 PASS / 0 FAIL / 3 NOT TESTED; assistant unit 19 + 17, browser 31, launcher 16; `test:images` 15 + 4, e2e 27, quality 11; `test:compress` 38; Excel to PDF 5; PDF to Word 8 + 9; PDF to Excel 11 + 7; DOCX tables 9; DOCX robust 12; OCR 7 + UI 6.

**Known failures identical to the clean base commit:** zoom 4 passed / 14 failed; theme 21 / 1; print 27 / 6; consent 65 / 1.


## 15. Final testing sign-off (2026-10-18)

Code under test: `web-only` at `e9b42a9` (15 commits ahead of origin), freshly built (`rm -rf .next && npx next build`, exit 0) and served with `npx next start -p 3117`. Everything marked "simulated" used synthetic frames or injected events, not a physical device.

### Commands and results (each run once on the fresh build; exit code and counts are from the run)
| Command | Exit | Result |
|---|---|---|
| `npx tsc --noEmit` | 0 | clean |
| `npx eslint .` | 0 | 0 errors, 17 existing warnings |
| `npx next build` | 0 | compiled successfully |
| `node --no-warnings --import ./tests/scanner/register.mjs tests/scanner/detection-safety.mjs --strict` | 0 | passed (simulated frames, real detector) |
| `node tests/scanner/camera-browser.mjs` | 0 | 14 passed (simulated camera) |
| `node tests/scanner/multipage-browser.mjs` | 0 | 5 passed |
| `node --no-warnings tests/pdf/crop-math.mjs` | 0 | 18 passed |
| `node tests/audit/verify-pdf-quality.mjs` | 0 | 18 passed |
| `node tests/audit/verify-pdf-auto.mjs` | 0 | 13 passed |
| `node tests/audit/verify-pdf-edit.mjs` (`test:pdf-edit`) | 0 | 11 passed |
| `node tests/audit/verify-fixes.mjs` (`test:quality-fixes`) | 0 | 23 passed |
| `node tests/audit/verify-print.mjs` (`test:print-quality`) | 0 | 3 passed |
| `npm run test:images` / `test:images:e2e` / `test:images:quality` | 0 | 15 + 4 / 27 / 11 passed |
| `npm run test:compress` | 0 | 38 passed, 0 failed |
| `npm run test:protect` | 1 | 55 passed, 1 failed (see below) |
| `npm run test:docx` | 1 | 18 variants match Word, 2 differ (see below) |
| `npm run test:docx:tables` / `test:docx:robust` | 0 | 9 / 12 passed |
| `node tests/audit/verify-excel.mjs` / `verify-pdf2word.mjs` | 0 | 5 / 8 + 9 passed |
| `npm run test:pdf2excel` | 0 | 11 + 7 passed |
| `npm run test:ocr` / `node tests/audit/verify-ocr-ui.mjs` | 0 | 7 / 6 passed |
| `npm run test:install` / `node tests/install/browser.mjs` | 0 | 71 / 56 passed |
| `node tests/install/verify-final.mjs` | 0 | 35 PASS, 0 FAIL, 3 NOT TESTED |
| `npm run test:assistant` / `tests/assistant/browser.mjs` / `launcher.mjs` | 0 | 19 + 17 / 31 / 16 passed |
| `node tests/zoom/verify.mjs` | 1 | 4 passed, 14 failed (pre-existing) |
| `node tests/ui/theme.mjs` | 1 | 21 passed, 1 failed (pre-existing) |
| `node tests/print/verify.mjs` | 1 | 27 passed, 6 failed (pre-existing, see below) |
| `node tests/consent/consent.mjs` | 1 | 65 passed, 1 failed (pre-existing) |

### The previously omitted suites, compared with a clean base
A temporary git worktree of the clean base `bb5a966` (before any of this work) was built and served, then removed (its directory had to be emptied with robocopy because of long paths; `git worktree list` shows only the two original worktrees).
- **`test:protect`**: current 55 ok / 1 fail; clean base 55 ok / 1 fail; the test names are identical. The one failure, "policy: Protect is public...", is a regular expression written with `\n` against `utils/tools/registry.ts`, which has CRLF line endings in this Windows checkout. A line-ending assumption in the test, not a product defect; unchanged.
- **`test:docx`**: current 18 matching / 2 differing (`04-tables`, `05-images`); clean base: the same two, with identical figures (04-tables: 5 lines off by more than 1 pt, 93 text mismatches, max x offset 170.5 pt; 05-images: 1 line off, max x offset 13.1 pt) and every other line of the output identical. Pre-existing.
- **zoom 14, theme 1, consent 1**: failure names identical to the clean-base lists recorded earlier.
- **print (`tests/print/verify.mjs`)**: 6 failures now. On the clean base this suite is slower and fails more: the run was cut off by a 25-minute limit after only 19 tests, with 13 failures, most of them "timed out waiting for ..." in tests that pass on the current build (Word import, Excel to PDF, compress, one-page, multi-page, Letter). Of the current 6 failures, 4 also fail on the clean base ("Create PDF -> Download PDF still saves a PDF" (the size check), "converted document: Word -> PDF result prints", "that browser print counts as ONE print event", "the Print button does not also count as a browser print"). The other 2 ("one Print press = exactly one print analytics event" and "a second press replaces the first job...") count analytics requests, which the test reads from the `/api/analytics/track` fetch without ever opting in to analytics; analytics is gated behind consent, so the count is always 0. They are the same mechanism as the two analytics tests that fail on the base, so they encode a requirement that predates consent gating; the clean base run ended before it reached them, so their base result is not directly observed. The current build's failure set was identical across two runs. No print behaviour regression: `test:print-quality` passes and the current build passes far more of this suite than the base.

New regressions found in this pass: none.

### Remaining limitations and items that need a real device (not claimed as verified)
- **Real-device validation still needed:** camera capture and the live guidance on a physical phone or webcam; Safari and iOS (camera, install steps, EXIF); the native PWA install prompt and the real `appinstalled` event (Chrome's installability check reported 0 errors, but automation never receives `beforeinstallprompt`); the guide steps on real iPhone, iPad, Android, Samsung, Mac and Firefox devices.
- **Simulated and labelled as such:** all camera results (Chrome fake video device, synthetic frames), install prompt states (dispatched events), device guides (spoofed user agents).
- **Product limitations:** Auto, Grayscale, Black & White, brightness and contrast make that one PDF page a picture (300 dpi, lower on very large pages); a rectangle crop only hides the cut-away area unless "remove for good" is chosen; links, form fields and bookmarks of an edited PDF page are not carried over; printing sends page pictures to the browser's print layer; direct Print fits to the paper; OCR still reads some O/0 and I/1/l from context (opt-in code-format control only); PDF to Word loses columns and wrapped pictures; automatic camera crop is limited to pages with a proven edge and everything else is a suggestion.
- **Still NOT TESTED anywhere:** XLSX charts, Word/Excel compression, Office-file protection, a real phone photograph, Safari/iOS memory behaviour, PDFs with encryption, form fields or links on an edited page.

### Git state at sign-off
Branch `web-only`, HEAD `e9b42a9`, 15 commits ahead of origin (none pushed). The 15 commits contain no backend, `.env`, handover, `.DS_Store` or `.claude` files, and a scan of their added lines for key, token and secret patterns found nothing. The pre-existing backend working-tree modifications (7 files) and the untracked handover, `.DS_Store`, `.claude` and other files are untouched.
