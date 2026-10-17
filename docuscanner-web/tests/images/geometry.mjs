// Unit checks for picture insertion: file sniffing, honest rejection messages, preset sizes in
// real millimetres, crop/rotate geometry and stacking order. Pure logic, no browser.
//   node tests/images/geometry.mjs
import assert from "node:assert/strict";
import {
  aspectCropRect,
  describeUnsupportedImage,
  getPreset,
  moveInStack,
  moveRect,
  pageSizeMm,
  PHOTO_PRESETS,
  presetFractions,
  rectFromPoints,
  rotatedBox,
  sniffImageKind,
  stackPosition,
} from "../../utils/scanner/imagePlacement.ts";
import { createImage, resizeAnnotation } from "../../utils/scanner/annotations.ts";

let pass = 0;
const test = (name, fn) => {
  fn();
  pass++;
  console.log("  ok  " + name);
};
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const bytes = (...b) => new Uint8Array(b);
const text = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

console.log("File sniffing");
test("recognises JPEG, PNG and WebP by content", () => {
  assert.equal(sniffImageKind(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0)), "jpeg");
  assert.equal(sniffImageKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)), "png");
  assert.equal(sniffImageKind(new Uint8Array([...text("RIFF"), 1, 2, 3, 4, ...text("WEBP")])), "webp");
});
test("a renamed non-image is not accepted", () => {
  assert.equal(sniffImageKind(text("%PDF-1.7 hello")), null);
  assert.equal(sniffImageKind(text("GIF89a......")), null);
  assert.equal(sniffImageKind(bytes()), null);
  assert.equal(sniffImageKind(bytes(0xff, 0xd8)), null);
});
test("rejections explain the real problem", () => {
  assert.match(describeUnsupportedImage(text("GIF89a......"), "a.jpg"), /GIF/);
  assert.match(describeUnsupportedImage(new Uint8Array([0, 0, 0, 0x18, ...text("ftypheic")]), "IMG.jpg"), /HEIC/);
  assert.match(describeUnsupportedImage(text("%PDF-1.4"), "x.png"), /PDF/);
  assert.match(describeUnsupportedImage(text("<svg xmlns"), "logo.svg"), /SVG/);
  assert.match(describeUnsupportedImage(text("PK\u0003\u0004"), "cv.docx"), /document/);
  assert.match(describeUnsupportedImage(text("zzzz"), "mystery.bin"), /JPG, PNG or WebP/);
});

console.log("Real-world sizes");
test("an A4 portrait page is 210 x 297 mm", () => {
  const p = pageSizeMm(1240, 1754);
  near(p.w, 210, 0.2);
  near(p.h, 297, 0.2);
});
test("a landscape page is scaled to the sheet, not stretched", () => {
  const p = pageSizeMm(2000, 1000);
  near(p.w, 210, 0.2);
  near(p.h, 105, 0.2);
});
test("35 x 45 mm on A4 is the right fraction of the page", () => {
  const f = presetFractions(getPreset("35x45mm"), 1240, 1754);
  near(f.w, 35 / 210, 0.002);
  near(f.h, 45 / 297, 0.002);
});
test("a preset that cannot fit on the page is refused rather than clipped", () => {
  assert.equal(presetFractions(getPreset("2x2in"), 100, 100) === null, false); // a square page fits (210 mm)
  assert.equal(presetFractions({ id: "x", label: "x", widthMm: 400, heightMm: 10 }, 1240, 1754), null);
});
test("every preset states its unit and size", () => {
  for (const p of PHOTO_PRESETS) assert.match(p.label, /(mm|in)/);
  assert.equal(new Set(PHOTO_PRESETS.map((p) => p.id)).size, PHOTO_PRESETS.length);
});

console.log("Placement, crop and rotate");
test("a new picture keeps its shape and stays on the page", () => {
  for (const [iw, ih] of [[300, 400], [4000, 300], [300, 4000], [1, 1]]) {
    const a = createImage("data:image/png;base64,AA", iw, ih, 1240, 1754);
    near((a.w * 1240) / (a.h * 1754), iw / ih, 0.02);
    assert.ok(a.x >= 0 && a.y >= 0 && a.x + a.w <= 1 + 1e-9 && a.y + a.h <= 1 + 1e-9, JSON.stringify(a));
  }
});
test("resizing keeps the aspect ratio and the picture on the page", () => {
  let a = createImage("data:image/png;base64,AA", 300, 400, 1240, 1754);
  const shape = (a.h * 1754) / (a.w * 1240);
  const bigger = resizeAnnotation(a, 5, 5, 1240, 1754);
  near((bigger.h * 1754) / (bigger.w * 1240), shape, 1e-9);
  assert.ok(bigger.x + bigger.w <= 1 + 1e-9 && bigger.y + bigger.h <= 1 + 1e-9);
  const smaller = resizeAnnotation(a, -5, -5, 1240, 1754);
  assert.ok(smaller.w >= 0.05 - 1e-9);
});
test("an aspect crop is the right shape and inside the image", () => {
  const r = aspectCropRect(3000, 2000, 35 / 45);
  near((r.w * 3000) / (r.h * 2000), 35 / 45, 1e-9);
  assert.ok(r.x >= 0 && r.x + r.w <= 1 + 1e-9 && r.y >= 0 && r.y + r.h <= 1 + 1e-9);
  const zoomed = aspectCropRect(3000, 2000, 35 / 45, 0.5, 0.9, 0.1);
  near(zoomed.w, r.w / 2, 1e-9);
  assert.ok(zoomed.x + zoomed.w <= 1 + 1e-9 && zoomed.y >= 0);
});
test("moving or drawing a crop box cannot leave the image", () => {
  const moved = moveRect({ x: 0.5, y: 0.5, w: 0.4, h: 0.4 }, 5, -5);
  near(moved.x, 0.6);
  near(moved.y, 0);
  const drawn = rectFromPoints(1.4, -0.2, 0.3, 0.6);
  assert.deepEqual([drawn.x, drawn.y, drawn.w, drawn.h].map((v) => Math.round(v * 100) / 100), [0.3, 0, 0.7, 0.6]);
});
test("a quarter turn swaps the picture's printed width and height", () => {
  const box = { x: 0.1, y: 0.1, w: 0.2, h: 0.3 };
  const r = rotatedBox(box, 1240, 1754);
  near(r.w * 1240, box.h * 1754, 1e-6);
  near(r.h * 1754, box.w * 1240, 1e-6);
  const corner = rotatedBox({ x: 0.8, y: 0.0, w: 0.2, h: 0.5 }, 1000, 1000);
  assert.ok(corner.x + corner.w <= 1 + 1e-9 && corner.y >= 0 && corner.y + corner.h <= 1 + 1e-9);
  const tall = rotatedBox({ x: 0, y: 0, w: 0.2, h: 1 }, 1000, 1000);
  assert.ok(tall.w <= 1 + 1e-9 && tall.h <= 1 + 1e-9);
});

console.log("Stacking order");
test("forward/backward/front/back reorder only the chosen item", () => {
  const list = ["a", "b", "c", "d"].map((id) => ({ id, type: "check", x: 0, y: 0, w: 0, h: 0, color: "" }));
  const ids = (l) => l.map((x) => x.id).join("");
  assert.equal(ids(moveInStack(list, "b", "forward")), "acbd");
  assert.equal(ids(moveInStack(list, "c", "backward")), "acbd");
  assert.equal(ids(moveInStack(list, "a", "front")), "bcda");
  assert.equal(ids(moveInStack(list, "d", "back")), "dabc");
  assert.equal(moveInStack(list, "d", "forward"), list);
  assert.equal(moveInStack(list, "zzz", "front"), list);
  assert.deepEqual(stackPosition(list, "a"), { canForward: true, canBackward: false });
  assert.deepEqual(stackPosition(list, "d"), { canForward: false, canBackward: true });
});

console.log(`\n${pass} checks passed`);
