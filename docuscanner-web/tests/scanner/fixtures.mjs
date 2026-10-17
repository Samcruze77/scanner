// Synthetic "camera frames" for the scanner tests. Every fixture has a known page outline and known edge markers, so a
// detected crop can be judged against the truth. These are SIMULATED captures (drawn pictures), not photographs.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createCanvas } = require("@napi-rs/canvas");

let seed = 11;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function polyPath(ctx, poly) {
  ctx.beginPath();
  poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}
function rotatedRect(cx, cy, w, h, deg) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
}
function desk(ctx, W, H, base = [58, 42, 30], noise = 14) {
  ctx.fillStyle = `rgb(${base})`;
  ctx.fillRect(0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H);
  for (let i = 0; i < d.data.length; i += 4) {
    const n = (rand() - 0.5) * noise * 2;
    d.data[i] += n;
    d.data[i + 1] += n;
    d.data[i + 2] += n;
  }
  ctx.putImageData(d, 0, 0);
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  for (let y = 0; y < H; y += 23) {
    ctx.beginPath();
    ctx.moveTo(0, y + rand() * 6);
    ctx.lineTo(W, y + rand() * 6);
    ctx.stroke();
  }
}
// Text lines and corner markers inside a page whose local frame is (0,0)-(pw,ph); `edge` is how close to the edge
// (as a fraction of the page) the printing comes.
function printPage(ctx, pw, ph, { edge = 0.06, lines = 28, dark = false } = {}) {
  ctx.fillStyle = dark ? "#f2f2f2" : "#111";
  const fs = Math.max(9, Math.round(ph / 60));
  ctx.font = `${fs}px Arial`;
  const mx = pw * edge, my = ph * edge;
  const step = (ph - 2 * my - fs) / (lines - 1);
  for (let i = 0; i < lines; i++) {
    const y = my + fs + i * step;
    let t = `SCAN-L${String(i + 1).padStart(2, "0")} The quick brown fox jumps over the lazy dog 0123456789`;
    while (ctx.measureText(t).width > pw - 2 * mx && t.length > 4) t = t.slice(0, -1);
    ctx.fillText(t, mx, y);
  }
  ctx.fillStyle = "#d00";
  const m = Math.max(8, pw * 0.012);
  const marks = [[mx, my], [pw - mx - m, my], [pw - mx - m, ph - my - m], [mx, ph - my - m]];
  for (const [x, y] of marks) ctx.fillRect(x, y, m, m);
  return marks.map(([x, y]) => ({ x: x + m / 2, y: y + m / 2 }));
}

function page(ctx, cx, cy, pw, ph, deg, opts = {}) {
  const poly = rotatedRect(cx, cy, pw, ph, deg);
  ctx.save();
  if (opts.shadow !== false) {
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetX = 8;
    ctx.shadowOffsetY = 10;
  }
  ctx.fillStyle = opts.paper ?? "#f4f1ea";
  polyPath(ctx, poly);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.translate(-pw / 2, -ph / 2);
  polyPath(ctx, [{ x: 0, y: 0 }, { x: pw, y: 0 }, { x: pw, y: ph }, { x: 0, y: ph }]);
  ctx.clip();
  const marks = printPage(ctx, pw, ph, opts);
  ctx.restore();
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const markers = marks.map(({ x, y }) => ({ x: cx + (x - pw / 2) * c - (y - ph / 2) * s, y: cy + (x - pw / 2) * s + (y - ph / 2) * c }));
  return { poly, markers };
}

const frameQuad = (W, H) => [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];

export function fixtures() {
  const out = [];
  const add = (name, W, H, draw, note) => {
    seed = 11 + out.length;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    const truth = draw(ctx, W, H);
    out.push({ name, W, H, canvas, ...truth, note });
  };
  add("desk-a4-rotated-5", 1600, 1200, (ctx, W, H) => { desk(ctx, W, H); return page(ctx, W / 2, H / 2, 800, 1000, 5, {}); }, "A4 on a dark desk, 5 degrees, shadow");
  add("desk-a4-portrait-frame", 1200, 1600, (ctx, W, H) => { desk(ctx, W, H); return page(ctx, W / 2, H / 2, 800, 1130, -3, {}); }, "portrait frame, portrait page");
  add("desk-landscape-page", 1600, 1200, (ctx, W, H) => { desk(ctx, W, H); return page(ctx, W / 2, H / 2, 1180, 830, 2, { lines: 20 }); }, "landscape page in a landscape frame");
  add("desk-big-fill", 1600, 1200, (ctx, W, H) => { desk(ctx, W, H); return page(ctx, W / 2, H / 2, 1010, 1130, 1, {}); }, "page fills 90% of the frame with a thin desk border");
  add("desk-edge-text", 1600, 1200, (ctx, W, H) => { desk(ctx, W, H); return page(ctx, W / 2, H / 2, 800, 1000, 4, { edge: 0.012 }); }, "printing within 1% of the page edges");
  add("desk-rotated-30", 1600, 1200, (ctx, W, H) => { desk(ctx, W, H); return page(ctx, W / 2, H / 2, 700, 900, 30, {}); }, "page turned 30 degrees");
  add("desk-receipt", 1200, 1600, (ctx, W, H) => { desk(ctx, W, H); return page(ctx, W / 2, H / 2, 260, 1150, 2, { lines: 30, edge: 0.05 }); }, "narrow receipt (22% of the frame width)");
  add("desk-uneven-light", 1600, 1200, (ctx, W, H) => {
    desk(ctx, W, H);
    const t = page(ctx, W / 2, H / 2, 800, 1000, -4, {});
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W * 0.55, 0);
    ctx.lineTo(W * 0.15, H);
    ctx.lineTo(0, H);
    ctx.fill();
    return t;
  }, "strong lighting gradient and a diagonal shadow across page and desk");
  add("table-lowcontrast", 1600, 1200, (ctx, W, H) => { ctx.fillStyle = "#fbfbf8"; ctx.fillRect(0, 0, W, H); return page(ctx, W / 2, H / 2, 800, 1000, 2, { paper: "#ecebe6", shadow: false }); }, "pale page on a white table, no shadow");
  add("clutter", 1600, 1200, (ctx, W, H) => {
    desk(ctx, W, H);
    const t = page(ctx, W * 0.45, H / 2, 760, 980, 3, {});
    ctx.fillStyle = "#c8a200";
    ctx.beginPath();
    ctx.arc(W * 0.9, H * 0.2, 70, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#223";
    ctx.fillRect(W * 0.8, H * 0.55, 40, 380);
    return t;
  }, "objects (a coin and a pen) on the desk next to the page");
  add("page-leaves-frame", 1600, 1200, (ctx, W, H) => { desk(ctx, W, H); return page(ctx, W * 0.55, H * 0.42, 900, 1250, 3, {}); }, "the page runs past the bottom of the frame");
  add("fullframe-text", 1600, 1200, (ctx, W, H) => {
    ctx.fillStyle = "#f6f4ee";
    ctx.fillRect(0, 0, W, H);
    const marks = printPage(ctx, W, H, { edge: 0.02, lines: 26 });
    return { poly: frameQuad(W, H), markers: marks };
  }, "the page fills the whole frame, printing within 2% of every edge");
  add("fullframe-thin-border", 1600, 1200, (ctx, W, H) => {
    desk(ctx, W, H, [235, 235, 232], 3);
    return page(ctx, W / 2, H / 2, 1560, 1160, 0, { edge: 0.03, shadow: false, paper: "#fffefa" });
  }, "a white page on a near-white surface");
  add("photo", 1600, 1200, (ctx, W, H) => {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#3a6ea5");
    g.addColorStop(0.5, "#e0a458");
    g.addColorStop(1, "#2f4f2f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#f2d0b0";
    ctx.beginPath();
    ctx.ellipse(W / 2, H / 2, 260, 330, 0, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#111";
    ctx.fillRect(W * 0.3, H * 0.4, 60, 30);
    ctx.fillRect(W * 0.62, H * 0.4, 60, 30);
    ctx.fillStyle = "#d00";
    for (const [x, y] of [[40, 40], [W - 70, 40], [W - 70, H - 70], [40, H - 70]]) ctx.fillRect(x, y, 30, 30);
    return { poly: frameQuad(W, H), markers: [[55, 55], [W - 55, 55], [W - 55, H - 55], [55, H - 55]].map(([x, y]) => ({ x, y })) };
  }, "a photograph with no document boundary");
  add("dark-page", 1600, 1200, (ctx, W, H) => { desk(ctx, W, H, [190, 185, 170], 6); return page(ctx, W / 2, H / 2, 800, 1000, 3, { paper: "#1c1c20", dark: true }); }, "black paper with light printing on a pale desk");
  add("grey-desk-pale-page", 1600, 1200, (ctx, W, H) => { desk(ctx, W, H, [150, 150, 148], 8); return page(ctx, W / 2, H / 2, 800, 1000, 6, { paper: "#c9c8c2" }); }, "mid-grey desk, pale grey page");
  add("blurred-edges", 1600, 1200, (ctx, W, H) => {
    desk(ctx, W, H);
    const t = page(ctx, W / 2, H / 2, 800, 1000, -6, {});
    const c2 = createCanvas(W, H);
    const x2 = c2.getContext("2d");
    x2.filter = "blur(9px)";
    x2.drawImage(ctx.canvas, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(c2, 0, 0);
    return t;
  }, "out-of-focus frame");
  add("page-with-black-header", 1600, 1200, (ctx, W, H) => {
    desk(ctx, W, H);
    const t = page(ctx, W / 2, H / 2, 800, 1000, 2, {});
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate((2 * Math.PI) / 180);
    ctx.fillStyle = "#101010";
    ctx.fillRect(-380, -480, 760, 140);
    ctx.restore();
    return t;
  }, "page with a heavy black printed header band");
  return out;
}

// A deterministic family of random desk scenes, to see how the policies behave beyond the hand-made cases.
export function randomFixture(i) {
  seed = 1000 + i * 7919;
  const landscape = rand() < 0.5;
  const W = landscape ? 1600 : 1200, H = landscape ? 1200 : 1600;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const deskLevel = 30 + rand() * 170;
  desk(ctx, W, H, [deskLevel, deskLevel * 0.9, deskLevel * 0.8], 4 + rand() * 16);
  const scale = 0.5 + rand() * 0.42;
  const pageIsLandscape = rand() < 0.3;
  const pw = (pageIsLandscape ? 1.41 : 1) * Math.min(W, H) * scale * (pageIsLandscape ? 0.8 : 0.8), ph = pageIsLandscape ? pw / 1.41 : pw * 1.41;
  const deg = (rand() - 0.5) * 50;
  const cx = W / 2 + (rand() - 0.5) * W * 0.12, cy = H / 2 + (rand() - 0.5) * H * 0.12;
  const t = page(ctx, cx, cy, Math.min(pw, W * 0.95), Math.min(ph, H * 0.95), deg, { edge: 0.01 + rand() * 0.07, lines: 18 + Math.floor(rand() * 14), paper: `rgb(${200 + rand() * 50},${200 + rand() * 50},${195 + rand() * 50})`, shadow: rand() < 0.7 });
  if (rand() < 0.4) {
    const g = ctx.createLinearGradient(0, 0, W, H * rand());
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${0.2 + rand() * 0.4})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  return { name: `random-${i}`, W, H, canvas, ...t, note: `random scene ${i}` };
}

// Share of the true page covered by the crop quad, and whether every marker is inside it, on a coarse grid.
export function judge(f, quad) {
  const inside = (poly, x, y) => {
    let s = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (c !== 0) {
        if (s === 0) s = Math.sign(c);
        else if (Math.sign(c) !== s) return false;
      }
    }
    return true;
  };
  let page = 0, kept = 0;
  const step = 8;
  for (let y = 0; y < f.H; y += step) for (let x = 0; x < f.W; x += step) {
    if (!inside(f.poly, x, y)) continue;
    page++;
    if (quad && inside(quad, x, y)) kept++;
  }
  const coverage = quad ? kept / Math.max(1, page) : 1;
  // Markers outside the frame are not part of the capture, so they cannot be lost by a crop.
  const visible = f.markers.filter((m) => m.x >= 0 && m.y >= 0 && m.x < f.W && m.y < f.H);
  const markersKept = quad ? visible.filter((m) => inside(quad, m.x, m.y)).length : visible.length;
  return { coverage, markersKept, markersTotal: visible.length };
}
