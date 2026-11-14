// Removing the paper behind an uploaded signature (utils/scanner/signature.ts, whiteToTransparent), on
// pictures with a known stroke: the paper must become fully transparent and the stroke stay solid, on
// white paper, on grey unevenly lit paper (a phone photo indoors), with pale ink, and for a PNG that is
// already transparent.
//   node --no-warnings --import ./tests/scanner/register.mjs tests/signature/background-unit.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createCanvas } = require("@napi-rs/canvas");
const { whiteToTransparent } = await import("../../utils/scanner/signature.ts");

const W = 900, H = 300;
function stroke(ctx, colour, width) {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(40, 220);
  ctx.bezierCurveTo(160, 20, 240, 280, 340, 110);
  ctx.bezierCurveTo(420, 20, 520, 270, 640, 120);
  ctx.lineTo(860, 90);
  ctx.stroke();
}
// The true stroke as a mask: the same path, black on white, no paper texture.
function truth(width) {
  const c = createCanvas(W, H);
  const x = c.getContext("2d");
  x.fillStyle = "#fff";
  x.fillRect(0, 0, W, H);
  stroke(x, "#000", width);
  return x.getImageData(0, 0, W, H).data;
}
function measure(name, paint, inkWidth, { viaJpeg = true } = {}) {
  let c = createCanvas(W, H);
  let x = c.getContext("2d");
  paint(x);
  if (viaJpeg) {
    // Through a JPEG, as a photo arrives (adds noise and ringing around the stroke).
    const { loadImage } = require("@napi-rs/canvas");
    const jpeg = c.toBuffer("image/jpeg", 82);
    return loadImage(jpeg).then((img) => {
      c = createCanvas(W, H);
      x = c.getContext("2d");
      x.drawImage(img, 0, 0);
      return score(name, x, inkWidth);
    });
  }
  return Promise.resolve(score(name, x, inkWidth));
}
function score(name, ctx, inkWidth) {
  const image = ctx.getImageData(0, 0, W, H);
  whiteToTransparent(image);
  const mask = truth(inkWidth);
  let paper = 0, paperLeft = 0, ink = 0, inkSolid = 0;
  for (let i = 0; i < mask.length; i += 4) {
    const alpha = image.data[i + 3];
    if (mask[i] > 250) {
      paper++;
      if (alpha > 8) paperLeft++;
    } else if (mask[i] < 5) {
      ink++;
      if (alpha >= 235) inkSolid++;
    }
  }
  const left = paperLeft / paper;
  const solid = inkSolid / ink;
  console.log(`  ${name}: paper left ${(left * 100).toFixed(2)}%, stroke solid ${(solid * 100).toFixed(1)}%`);
  return { left, solid };
}

const cases = [
  ["black ink on white paper", (x) => { x.fillStyle = "#fff"; x.fillRect(0, 0, W, H); stroke(x, "#111", 7); }, 7],
  ["blue ballpoint on grey paper, light falling off to one side", (x) => {
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#c8c4bc");
    g.addColorStop(1, "#9c988f");
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    stroke(x, "#3a4a80", 7);
  }, 7],
  ["dim photo: paper at 140, dark ink", (x) => { x.fillStyle = "#8c8c8c"; x.fillRect(0, 0, W, H); stroke(x, "#2a2a2a", 7); }, 7],
  ["pencil on white paper (pale ink)", (x) => { x.fillStyle = "#fbfbfb"; x.fillRect(0, 0, W, H); stroke(x, "#8a8a8a", 6); }, 6],
  ["thick marker on cream paper", (x) => { x.fillStyle = "#efe6cf"; x.fillRect(0, 0, W, H); stroke(x, "#101010", 26); }, 26],
];
let pass = 0;
for (const [name, paint, width] of cases) {
  const r = await measure(name, paint, width);
  // The edge ring of a stroke (anti-aliasing, JPEG ringing) is not counted as paper by the mask, so
  // anything left on the paper is real haze.
  assert.ok(r.left < 0.01, `${name}: the paper is removed (left ${(r.left * 100).toFixed(2)}%)`);
  assert.ok(r.solid > 0.9, `${name}: the stroke stays solid (${(r.solid * 100).toFixed(1)}%)`);
  pass++;
}
{
  const r = await measure("PNG that is already transparent", (x) => stroke(x, "#1a3fa8", 9), 9, { viaJpeg: false });
  assert.ok(r.left < 0.01 && r.solid > 0.9, "a transparent PNG keeps its stroke and stays transparent");
  pass++;
}
console.log(`${pass} cases passed`);
