// Can a detected crop be applied without asking? The boundary detector (detection.ts) is a heuristic: it takes the
// outline of every strong edge in the frame, which is the page edge when a page lies on a contrasting surface, but
// is only the bounds of the printed text when the page fills the frame, and can be anything for a photograph. Cutting
// at the wrong place loses real content, so a crop is applied automatically only when this check can see a genuine
// page boundary on every side of it; otherwise it is offered as a suggestion (see ScannerWorkspace.tsx).
//
// The check looks across each edge of the crop for a consistent step in brightness (page against surface) and
// requires paper-like content inside. An edge that lies on the frame itself removes nothing and passes. Pure maths on
// a grey picture, no DOM, so it is tested directly (tests/scanner/detection-safety.mjs).

export interface P {
  x: number;
  y: number;
}

export interface EdgeReport {
  atFrame: boolean;
  step: number; // median brightness inside minus outside (grey levels), NaN for an edge on the frame
  consistent: number; // share of samples agreeing with the median step
  ok: boolean;
}

export interface SafetyResult {
  safe: boolean;
  reason: string;
  edges: EdgeReport[];
}

const STEP_MIN = 25;
const SAMPLE_STEP_MIN = 12;
const CONSISTENT_MIN = 0.75;
const PAPER_NEAR = 45;
const PAPER_SHARE_MIN = 0.55;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
}

// `gray` is w*h brightness values (0-255), `quad` is in the same pixel coordinates, clockwise or not.
export function assessCropSafety(gray: ArrayLike<number>, w: number, h: number, quad: P[]): SafetyResult {
  const edges: EdgeReport[] = [];
  const minDim = Math.min(w, h);
  const near = Math.max(2, 0.012 * minDim);
  const far = Math.max(5, 0.05 * minDim);
  const cx = quad.reduce((s, p) => s + p.x, 0) / quad.length;
  const cy = quad.reduce((s, p) => s + p.y, 0) / quad.length;
  const at = (x: number, y: number): number | null => {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h) return null;
    return gray[yi * w + xi];
  };
  const strip = (x: number, y: number, nx: number, ny: number, sign: 1 | -1): number | null => {
    let sum = 0, n = 0;
    for (let d = near; d <= far; d += 1.5) {
      const v = at(x + sign * nx * d, y + sign * ny * d);
      if (v !== null) {
        sum += v;
        n++;
      }
    }
    return n >= 2 ? sum / n : null;
  };

  for (let i = 0; i < quad.length; i++) {
    const a = quad[i], b = quad[(i + 1) % quad.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1) {
      edges.push({ atFrame: false, step: NaN, consistent: 0, ok: false });
      continue;
    }
    let nx = (b.y - a.y) / len, ny = -(b.x - a.x) / len;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if ((mx - cx) * nx + (my - cy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const steps: number[] = [];
    let frame = 0, total = 0;
    const count = Math.max(8, Math.ceil(len / 3));
    for (let k = 0; k < count; k++) {
      const t = 0.08 + (0.84 * k) / (count - 1);
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      total++;
      const inside = strip(x, y, nx, ny, -1);
      const outside = strip(x, y, nx, ny, 1);
      if (outside === null) {
        frame++; // nothing beyond this edge: it lies on the frame
        continue;
      }
      if (inside === null) continue;
      steps.push(inside - outside);
    }
    if (frame / total >= 0.8) {
      edges.push({ atFrame: true, step: NaN, consistent: 1, ok: true });
      continue;
    }
    const med = median(steps);
    const agree = steps.length ? steps.filter((s) => Math.sign(s) === Math.sign(med) && Math.abs(s) >= SAMPLE_STEP_MIN).length / steps.length : 0;
    edges.push({ atFrame: false, step: med, consistent: agree, ok: Math.abs(med) >= STEP_MIN && agree >= CONSISTENT_MIN });
  }

  // A corner on the frame means the page probably continues outside it (or is cut by the frame). The straight line
  // between the detected corners then cuts a wedge off the part that is in view, so it is not applied unasked.
  const m = Math.max(2, 0.005 * minDim);
  const wholeFrame = edges.every((e) => e.atFrame);
  if (!wholeFrame && quad.some((p) => p.x <= m || p.y <= m || p.x >= w - 1 - m || p.y >= h - 1 - m)) {
    return { safe: false, reason: "the page runs to the edge of the frame", edges };
  }

  const bad = edges.findIndex((e) => !e.ok);
  if (bad >= 0) return { safe: false, reason: `no clear page edge on side ${bad + 1}`, edges };
  const signs = new Set(edges.filter((e) => !e.atFrame).map((e) => Math.sign(e.step)));
  if (signs.size > 1) return { safe: false, reason: "the edges disagree about which side is the page", edges };

  // Paper-like inside: most of the area is close to one brightness (text and pictures are the minority).
  const xs = quad.map((p) => p.x), ys = quad.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  const inside = (x: number, y: number) => {
    let sign = 0;
    for (let i = 0; i < quad.length; i++) {
      const a = quad[i], b = quad[(i + 1) % quad.length];
      const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (cross !== 0) {
        if (sign === 0) sign = Math.sign(cross);
        else if (Math.sign(cross) !== sign) return false;
      }
    }
    return true;
  };
  const vals: number[] = [];
  for (let y = y0; y <= y1; y += 3) for (let x = x0; x <= x1; x += 3) if (inside(x, y)) vals.push(gray[y * w + x]);
  if (vals.length < 50) return { safe: false, reason: "the crop is too small to check", edges };
  const med = median(vals);
  const share = vals.filter((v) => Math.abs(v - med) <= PAPER_NEAR).length / vals.length;
  if (share < PAPER_SHARE_MIN) return { safe: false, reason: "the inside does not look like a page", edges };
  return { safe: true, reason: "a clear page edge on every side", edges };
}
