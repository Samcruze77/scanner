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
