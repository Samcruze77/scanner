// Unit checks for picture quality: EXIF orientation detection (so camera-rotated JPEGs are
// redrawn instead of embedded sideways), non-destructive edit geometry, and print resolution.
//   node tests/images/quality-unit.mjs
import assert from "node:assert/strict";
import { aspectRectWithin, effectiveDpi, jpegOrientation, rotateRect } from "../../utils/scanner/imagePlacement.ts";

let pass = 0;
const test = (name, fn) => {
  fn();
  pass++;
  console.log("  ok  " + name);
};
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const bytes = (...b) => new Uint8Array(b);
const text = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

// A minimal JPEG header carrying an EXIF orientation tag.
function jpegWithOrientation(value, little = true) {
  const w16 = (v) => (little ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const w32 = (v) => (little ? [v & 255, (v >> 8) & 255, 0, 0] : [0, 0, (v >> 8) & 255, v & 255]);
  const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...w16(42), ...w32(8), ...w16(1), ...w16(0x0112), ...w16(3), ...w32(1), ...w16(value), 0, 0, ...w32(0)];
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = body.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...body, 0xff, 0xd9]);
}

console.log("Quality: orientation, non-destructive edits, resolution");
test("EXIF orientation is read in both byte orders", () => {
  for (const v of [1, 3, 6, 8]) {
    assert.equal(jpegOrientation(jpegWithOrientation(v, true)), v);
    assert.equal(jpegOrientation(jpegWithOrientation(v, false)), v);
  }
  assert.equal(jpegOrientation(bytes(0xff, 0xd8, 0xff, 0xdb, 0, 4, 0, 0)), 1);
  assert.equal(jpegOrientation(text("not a jpeg")), 1);
  assert.equal(jpegOrientation(bytes()), 1);
});
test("turning a crop with the picture: right then left returns it; four turns return it", () => {
  const r = { x: 0.1, y: 0.2, w: 0.3, h: 0.5 };
  const back = rotateRect(rotateRect(r, 1), -1);
  for (const k of ["x", "y", "w", "h"]) near(back[k], r[k]);
  const four = [1, 1, 1, 1].reduce((acc, d) => rotateRect(acc, d), r);
  for (const k of ["x", "y", "w", "h"]) near(four[k], r[k]);
  const once = rotateRect({ x: 0, y: 0, w: 0.25, h: 0.5 }, 1); // top-left block moves to the top-right
  near(once.x, 0.5);
  near(once.y, 0);
  near(once.w, 0.5);
  near(once.h, 0.25);
});
test("a photo size is cut from inside the existing crop, never stretched", () => {
  const r = aspectRectWithin({ x: 0.1, y: 0.1, w: 0.8, h: 0.6 }, 4000, 3000, 35 / 45);
  near((r.w * 4000) / (r.h * 3000), 35 / 45, 1e-9);
  assert.ok(r.x >= 0.1 - 1e-9 && r.y >= 0.1 - 1e-9 && r.x + r.w <= 0.9 + 1e-9 && r.y + r.h <= 0.7 + 1e-9);
  const tall = aspectRectWithin({ x: 0, y: 0, w: 0.2, h: 1 }, 3000, 4000, 35 / 45);
  near((tall.w * 3000) / (tall.h * 4000), 35 / 45, 1e-9);
});
test("resolution at the printed size is worked out in real dpi", () => {
  const frac = 35 / 210; // a 35 mm wide photo on A4 (210 mm)
  near(effectiveDpi(1000, frac, 1240, 1754), Math.round(1000 / (35 / 25.4)), 1);
  assert.ok(effectiveDpi(1000, frac, 1240, 1754) > 700);
  assert.ok(effectiveDpi(200, frac, 1240, 1754) < 150, "a 200 px picture at 35 mm is soft");
  assert.equal(effectiveDpi(undefined, frac, 1240, 1754), null);
  assert.equal(effectiveDpi(500, 0, 1240, 1754), null);
});

console.log(`\n${pass} checks passed`);
