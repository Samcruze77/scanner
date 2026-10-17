// Crop geometry for imported PDF pages (no browser). node --no-warnings tests/pdf/crop-math.mjs
import assert from "node:assert/strict";
import { RECT_TOLERANCE_PX, axisAlignedRect, cropToUserSpace, flattenReason } from "../../utils/scanner/cropMath.ts";

let pass = 0;
const ok = (n, f) => {
  f();
  pass++;
  console.log("  ok  " + n);
};
const quad = (l, t, r, b) => [{ x: l, y: t }, { x: r, y: t }, { x: r, y: b }, { x: l, y: b }];
const close = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);

console.log("rectangle detection");
ok("an exact rectangle", () => assert.deepEqual(axisAlignedRect(quad(10, 20, 110, 220)), { left: 10, top: 20, right: 110, bottom: 220 }));
ok("within the tolerance counts as a rectangle", () => assert.ok(axisAlignedRect([{ x: 10, y: 20 }, { x: 110, y: 20.5 }, { x: 110.4, y: 220 }, { x: 10.3, y: 220.2 }])));
ok("a skewed quad is not a rectangle", () => assert.equal(axisAlignedRect([{ x: 10, y: 20 }, { x: 110, y: 28 }, { x: 105, y: 220 }, { x: 12, y: 210 }]), null));
ok("a quad just over the tolerance is not", () => assert.equal(axisAlignedRect([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: RECT_TOLERANCE_PX + 1, y: 100 }]), null));
ok("an inside-out or empty quad is rejected", () => {
  assert.equal(axisAlignedRect(quad(50, 50, 40, 90)), null);
  assert.equal(axisAlignedRect([]), null);
});

console.log("picture crop -> PDF box (page 600 x 800 pt, picture 1200 x 1600 px; rect = middle-left)");
const box = { x: 0, y: 0, width: 600, height: 800 };
const rect = { left: 120, top: 400, right: 600, bottom: 1200 }; // 0.1..0.5 across, 0.25..0.75 down
ok("no /Rotate: y is flipped", () => {
  const u = cropToUserSpace(box, 0, rect, 1200, 1600);
  [u.left, u.right, u.bottom, u.top].forEach((v, i) => close(v, [60, 300, 200, 600][i]));
});
ok("/Rotate 90 (picture is 800 x 600 pt)", () => {
  // picture px 1200 x 1600 for a rotated frame of 800 x 600 pt is not square-pixel; use 1600 x 1200 instead
  const r = { left: 160, top: 300, right: 800, bottom: 900 }; // 0.1..0.5 across, 0.25..0.75 down of an 800 x 600 frame
  const u = cropToUserSpace(box, 90, r, 1600, 1200);
  // frame X (0.1..0.5)*800 = 80..400 -> unrotated y' = H - X = 720..400 -> user y = H - y' = 80..400
  // frame Y (0.25..0.75)*600 = 150..450 -> unrotated x' = Y -> user x = 150..450
  [u.left, u.right, u.bottom, u.top].forEach((v, i) => close(v, [150, 450, 80, 400][i]));
});
ok("/Rotate 180", () => {
  const u = cropToUserSpace(box, 180, rect, 1200, 1600);
  // X = 60..300 -> x' = 600 - X = 540..300; Y = 200..600 -> y' = 800 - Y = 600..200 -> user y = 800 - y' = 200..600
  [u.left, u.right, u.bottom, u.top].forEach((v, i) => close(v, [300, 540, 200, 600][i]));
});
ok("/Rotate 270", () => {
  const r = { left: 160, top: 300, right: 800, bottom: 900 };
  const u = cropToUserSpace(box, 270, r, 1600, 1200);
  // X = 80..400 -> y' = X; Y = 150..450 -> x' = W - Y = 450..150; user y = H - y' = 720..400
  [u.left, u.right, u.bottom, u.top].forEach((v, i) => close(v, [150, 450, 400, 720][i]));
});
ok("a page whose box does not start at the origin", () => {
  const u = cropToUserSpace({ x: 10, y: 20, width: 600, height: 800 }, 0, rect, 1200, 1600);
  [u.left, u.right, u.bottom, u.top].forEach((v, i) => close(v, [70, 310, 220, 620][i]));
});
ok("a crop that pokes out is clamped to the page", () => {
  const u = cropToUserSpace(box, 0, { left: -50, top: -50, right: 5000, bottom: 5000 }, 1200, 1600);
  assert.deepEqual([u.left, u.right, u.bottom, u.top], [0, 600, 0, 800]);
});

console.log("what flattens a page");
const base = { cropEnabled: false, quad: null, enhancement: "original", brightness: 0, contrast: 0 };
ok("nothing edited, or only rotated/annotated: keeps its text", () => assert.equal(flattenReason(base), null));
ok("a rectangle crop keeps its text", () => assert.equal(flattenReason({ ...base, cropEnabled: true, quad: quad(0, 0, 50, 50) }), null));
ok("crop switched on without a crop shape changes nothing", () => assert.equal(flattenReason({ ...base, cropEnabled: true }), null));
ok("grayscale, black and white and auto flatten", () => {
  for (const m of ["grayscale", "bw", "auto"]) assert.equal(flattenReason({ ...base, enhancement: m }), "enhancement");
});
ok("brightness or contrast flatten", () => {
  assert.equal(flattenReason({ ...base, brightness: 5 }), "adjustment");
  assert.equal(flattenReason({ ...base, contrast: -5 }), "adjustment");
});
ok("a skewed crop and a remove-for-good crop flatten", () => {
  assert.equal(flattenReason({ ...base, cropEnabled: true, quad: [{ x: 0, y: 0 }, { x: 50, y: 5 }, { x: 50, y: 50 }, { x: 0, y: 50 }] }), "skewed-crop");
  assert.equal(flattenReason({ ...base, cropEnabled: true, quad: quad(0, 0, 50, 50), cropPermanent: true }), "permanent-crop");
});
ok("remove-for-good has no effect while the crop is off", () => assert.equal(flattenReason({ ...base, cropPermanent: true }), null));

console.log(`\n${pass} checks passed`);
