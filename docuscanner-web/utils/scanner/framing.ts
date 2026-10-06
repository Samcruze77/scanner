// Document size and framing thresholds shared by page detection
// (detection.ts) and the live camera guidance (CameraCapture.tsx). Area values
// are the share of the frame covered by the document's four-corner quad.
//
//   area < MIN_DETECTABLE      -> detector returns nothing ("not detected");
//                                 receipts and other small documents land here
//                                 and are captured manually
//   MIN_DETECTABLE <= area < MIN_COMFORTABLE
//                              -> detected but "small" (narrow band by design)
//   area >= MIN_COMFORTABLE    -> big enough to be "Ready" if also inside margins
//
// Detection measures the raw quad; the guidance measures the quad after the
// crop safety margin is added (~5% more area), so the effective "ready" size is
// about 17% of the frame in raw terms. A whole A4 sheet held at a natural
// distance covers roughly 20-40% of a 4:3 frame, so ordinary documents never
// need to be held unnaturally close.
export const MIN_DETECTABLE_AREA_RATIO = 0.15;
export const MAX_DETECTABLE_AREA_RATIO = 0.97;
export const MIN_COMFORTABLE_AREA_RATIO = 0.18;

// Distance of the nearest document corner from the frame edge, as a fraction of
// the frame. Below OUTSIDE the page is cut off; below TOUCHING it has no margin.
export const OUTSIDE_EDGE_FRACTION = 0.005;
export const TOUCHING_EDGE_FRACTION = 0.03;
