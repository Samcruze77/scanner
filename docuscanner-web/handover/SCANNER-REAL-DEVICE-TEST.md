# Scanner real-device test (Android Chrome, iPhone Safari, desktop webcam)

Status before this test: the software pipeline is verified in a browser with a mock camera
(requested resolution, top-up, capture, crop, PDF). **No physical phone camera has been verified.**
This document is how to verify that.

## 0. Setup

1. Open the live site on the phone at `/scan?camdebug=1` (https is required for the camera).
2. Debug mode adds, only because of `?camdebug=1`:
   - a small overlay on the camera preview (requested, opened and selected mode, top-up result, facing, focus, zoom);
   - a "Scanner diagnostics" panel at the bottom of the page with a **Copy diagnostics** button
     (a read-only text box you can long-press and copy if the button fails).
   - The panel logs, in order: `camera` (what the browser really gave us), `capture` (frame size, stored size, JPEG bytes),
     `render` (original -> processed scan size, JPEG bytes), `pdf` (PDF bytes, processed scan sizes, image sizes embedded in the PDF).
3. Without `?camdebug=1` none of this appears.
4. After each test document, copy the diagnostics and paste them into the notes (or send them over).

## 1. How to read the diagnostics

| Field | Healthy | Problem means |
|---|---|---|
| `requested` | `ideal 4096x3072 + rear camera` | "FAILED ... retried" means the browser refused the high request |
| `openedMode` | anything | what the browser picked before our top-up |
| `resolutionTopUp` | `succeeded` or `not needed` | `failed` / `no change` / `skipped`: the browser will not go higher; the camera supplies that frame size |
| `selectedMode`, `width`, `height`, `aspectRatio` | 4:3, 16:9 or portrait, whatever the sensor is | we never force a ratio |
| `sensorMaxMode` | the camera's best mode | if `selectedMode` is far below it, resolution is browser-limited |
| `focusSupported` / `focusActive` | Chrome Android: includes `continuous`, active `continuous` | iOS Safari: "not exposed" is normal |
| `zoomActive` | `none (never applied)` | the app never applies zoom |
| `capture.sourceFrame` vs `capture.storedOriginal` | equal, `downscaled: false` | if a real frame is small here, the camera supplied a low-res frame |
| `render.processed` | close to the page's pixel size in the frame (+3-5% margin) | much smaller than the page in the frame means loss in processing |
| `pdf.embeddedImages` | equal to `pdf.processedScans` sizes | any difference means loss in PDF creation |

`videoElementFrame` in the camera entry is read right after the top-up and can still show the old size; trust `capture.sourceFrame`.

## 2. Test documents (use all five)

1. One clean A4 (or Letter) page of normal printed text.
2. One page with small 7-9 pt text.
3. One slightly rotated page (about 5-10 degrees).
4. One page on a cluttered or dark background.
5. One receipt or other small document.

## 3. Procedure for each document

1. Open `/scan?camdebug=1`, tap **Use camera** and allow the camera.
2. Hold the phone above the document. Do not pinch-zoom.
3. Keep the entire page visible with a margin around it; the preview should look like the camera's normal view.
4. Wait for **Ready to scan** (not available for receipts or when the background confuses detection; capture manually then).
5. Tap **Capture page**.
6. Open the resulting scan, then **Create PDF**, then open the PDF.
7. Zoom to 200-300%.
8. Compare with the original paper page.
9. Copy the diagnostics.

Success criteria: text is sharp; no page edge is clipped; perspective correction is acceptable;
no artificial blur; no unexpected zoom in the preview; the PDF stays clear when enlarged.

## 4. Record sheet: Android Chrome (rear camera)

| Item | Result |
|---|---|
| Device model | |
| Android version | |
| Chrome version | |
| Requested resolution (`requested`) | |
| Actual selected resolution (`selectedMode`) | |
| Resolution top-up result | |
| Autofocus reported (`focusSupported` / `focusActive`) | |
| Text becomes sharp before capture (Y/N) | |
| Full A4 page fits comfortably (Y/N) | |
| Any page edge clipped (Y/N, which) | |
| Final captured image dimensions (`capture.storedOriginal`) | |
| Processed scan dimensions (`render.processed`) | |
| PDF file size (`pdf.pdfBytes`) | |
| Text readable at 200-300% zoom (Y/N) | |
| "Ready to scan" shown correctly (Y/N) | |
| Rotate to landscape: preview re-fits, no stretch (Y/N) | |

Repeat the five documents; at minimum fill the table for documents 1 and 2, and note pass/fail for 3-5.

## 5. Record sheet: iPhone Safari

Same table as above. Notes specific to iOS:
- Safari does not expose `focusMode`; `focusSupported` saying "not exposed" is expected. Judge focus by whether text is sharp
  before capture. iOS focuses continuously on its own.
- Compare the preview with the stock Camera app at 1x to check there is no unexpected zoom or crop.
- Check that the address bar showing or hiding does not push the Capture button out of reach.
- Capture 5 or more pages in a row to check for memory problems at the larger resolution (the tab must not reload).

| Item | Result |
|---|---|
| Device model / iOS version / Safari version | |
| Requested / selected resolution / top-up | |
| Text sharp before capture (Y/N) | |
| Full A4 fits comfortably (Y/N) | |
| Any page edge clipped (Y/N) | |
| Captured dimensions / processed dimensions | |
| PDF size | |
| Readable at 200-300% (Y/N) | |
| 5+ captures without reload (Y/N) | |

## 6. Desktop Chrome (webcam fallback)

- [ ] Webcam opens; the preview matches the webcam's real ratio (often 16:9) and is not cropped.
- [ ] `selectedMode` equals the webcam's mode; the captured scan has that same size (a webcam cannot provide more detail than it has).
- [ ] Block camera permission: the "upload a photo instead" message appears and uploading still works.
- [ ] No webcam attached: the unsupported/no-camera message appears.
- [ ] Text sharpness is limited by the webcam, not by the app: compare `capture.sourceFrame` to the webcam's native mode.

## 7. Deciding where quality was lost

- Low `selectedMode` / `capture.sourceFrame` and `resolutionTopUp` not succeeding: the browser or camera is providing a low-resolution frame. This is a device/browser limit, not our processing.
- High `capture.sourceFrame` but small `render.processed` for a page that fills the frame: investigate processing.
- `render.processed` fine but `pdf.embeddedImages` smaller: investigate PDF creation.
- Everything high but text looks soft in the paper-versus-scan comparison: focus (check `focusActive`, retake with the phone steady and further back, tap to refocus if the OS offers it).

## 8. Known behaviour (not bugs)

- Small documents (below about 15% of the frame) are "not detected"; capture them manually.
- Detection is a heuristic; cluttered backgrounds can show an amber outline or none even when the page fits.
- Guidance is conservative by a few percent because the crop safety margin (1.2%) is included.
- Photos are stored as JPEG at quality 0.92 and capped at 4096 px on the long side.
