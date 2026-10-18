// The Edit Image tool's edit model, as pure maths with no DOM so it can be tested on its own.
//
// An edit is never baked into pixels between steps. The tool keeps the decoded original and a small
// description of what to do to it (`EditState`); the preview and the download are both drawn from the
// ORIGINAL pixels with that description, once. That is what keeps repeated edits from compounding
// loss and lets a 4000 x 3000 photo export at 4000 x 3000 however small the on-screen preview is.
//
// The order is fixed: crop -> rotate -> flip -> resize -> brightness/contrast.
//   - `crop` is a rectangle in the ORIGINAL (upright) picture's pixels.
//   - `rotation` is clockwise, in quarter turns.
//   - `flipH` / `flipV` mirror the rotated picture, so "flip horizontal" always mirrors what you see.
//   - `resize` is the final width and height in pixels; null means "the natural size".

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export interface EditState {
  crop: Rect | null;
  rotation: Rotation;
  flipH: boolean;
  flipV: boolean;
  resize: { w: number; h: number } | null;
  // -100..100, the same scale and curve as the scanner's page editor.
  brightness: number;
  contrast: number;
}

export const IDENTITY_STATE: EditState = Object.freeze({
  crop: null,
  rotation: 0,
  flipH: false,
  flipV: false,
  resize: null,
  brightness: 0,
  contrast: 0,
}) as EditState;

// The limits the tool enforces, so a huge picture gets a clear message instead of a crashed tab or a
// corrupted export. Chosen conservatively; tests/images/edit-browser.mjs exercises a 48-megapixel picture.
export const LIMITS = {
  maxInputPixels: 64_000_000,
  maxOutputPixels: 64_000_000,
  maxSide: 16384,
  maxFileBytes: 100 * 1024 * 1024,
} as const;

export function rectEquals(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function statesEqual(a: EditState, b: EditState): boolean {
  return (
    rectEquals(a.crop, b.crop) &&
    a.rotation === b.rotation &&
    a.flipH === b.flipH &&
    a.flipV === b.flipV &&
    (a.resize === b.resize || (!!a.resize && !!b.resize && a.resize.w === b.resize.w && a.resize.h === b.resize.h)) &&
    a.brightness === b.brightness &&
    a.contrast === b.contrast
  );
}

// True when drawing the original with this state would change nothing.
export function isIdentity(state: EditState, srcW: number, srcH: number): boolean {
  const g = geometry(srcW, srcH, state);
  const fullCrop = g.crop.x === 0 && g.crop.y === 0 && g.crop.w === srcW && g.crop.h === srcH;
  return fullCrop && state.rotation === 0 && !state.flipH && !state.flipV && g.outW === srcW && g.outH === srcH && state.brightness === 0 && state.contrast === 0;
}

export function turned(rotation: Rotation): boolean {
  return rotation === 90 || rotation === 270;
}

// The size of the whole original after rotating it (what the crop tool shows).
export function viewSize(srcW: number, srcH: number, rotation: Rotation): { w: number; h: number } {
  return turned(rotation) ? { w: srcH, h: srcW } : { w: srcW, h: srcH };
}

export function clampRectTo(rect: Rect, bounds: { w: number; h: number }): Rect {
  const x = Math.min(Math.max(0, Math.round(rect.x)), Math.max(0, bounds.w - 1));
  const y = Math.min(Math.max(0, Math.round(rect.y)), Math.max(0, bounds.h - 1));
  const w = Math.min(Math.max(1, Math.round(rect.w)), bounds.w - x);
  const h = Math.min(Math.max(1, Math.round(rect.h)), bounds.h - y);
  return { x, y, w, h };
}

export interface Geometry {
  // The part of the original that is kept, in original pixels.
  crop: Rect;
  // Size after crop and rotation, before any resize.
  rotW: number;
  rotH: number;
  // Final size.
  outW: number;
  outH: number;
}

export function geometry(srcW: number, srcH: number, state: EditState): Geometry {
  const crop = state.crop ? clampRectTo(state.crop, { w: srcW, h: srcH }) : { x: 0, y: 0, w: srcW, h: srcH };
  const rotated = viewSize(crop.w, crop.h, state.rotation);
  const outW = state.resize ? Math.max(1, Math.round(state.resize.w)) : rotated.w;
  const outH = state.resize ? Math.max(1, Math.round(state.resize.h)) : rotated.h;
  return { crop, rotW: rotated.w, rotH: rotated.h, outW, outH };
}

// ---- affine maths (a 2D transform as [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f) -------

export type Matrix = [number, number, number, number, number, number];

export function multiply(m: Matrix, n: Matrix): Matrix {
  // The result applies `n` first and then `m`.
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function applyMatrix(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

// Maps a region of size cw x ch (the cropped picture) into its rotated and flipped frame.
export function orientationMatrix(cw: number, ch: number, rotation: Rotation, flipH: boolean, flipV: boolean): Matrix {
  let m: Matrix;
  let rw = cw;
  let rh = ch;
  switch (rotation) {
    case 90:
      m = [0, 1, -1, 0, ch, 0];
      rw = ch;
      rh = cw;
      break;
    case 180:
      m = [-1, 0, 0, -1, cw, ch];
      break;
    case 270:
      m = [0, -1, 1, 0, 0, cw];
      rw = ch;
      rh = cw;
      break;
    default:
      m = [1, 0, 0, 1, 0, 0];
  }
  if (flipH) m = multiply([-1, 0, 0, 1, rw, 0], m);
  if (flipV) m = multiply([1, 0, 0, -1, 0, rh], m);
  return m;
}

// The matrix that draws the cropped region (coordinates local to the crop) onto a canvas of the final
// size: orientation first, then scaling to the final width and height.
export function drawMatrix(g: Geometry, state: EditState): Matrix {
  const o = orientationMatrix(g.crop.w, g.crop.h, state.rotation, state.flipH, state.flipV);
  return multiply([g.outW / g.rotW, 0, 0, g.outH / g.rotH, 0, 0], o);
}

// A rectangle of the ORIGINAL picture as it appears in the rotated and flipped whole picture.
export function sourceRectToView(rect: Rect, srcW: number, srcH: number, state: Pick<EditState, "rotation" | "flipH" | "flipV">): Rect {
  const m = orientationMatrix(srcW, srcH, state.rotation, state.flipH, state.flipV);
  return boundsOf(m, rect);
}

// The reverse: a rectangle drawn on the rotated and flipped whole picture, as original pixels.
export function viewRectToSource(rect: Rect, srcW: number, srcH: number, state: Pick<EditState, "rotation" | "flipH" | "flipV">): Rect {
  const m = invert(orientationMatrix(srcW, srcH, state.rotation, state.flipH, state.flipV));
  return boundsOf(m, rect);
}

function boundsOf(m: Matrix, rect: Rect): Rect {
  const p = applyMatrix(m, rect.x, rect.y);
  const q = applyMatrix(m, rect.x + rect.w, rect.y + rect.h);
  const x = Math.round(Math.min(p.x, q.x));
  const y = Math.round(Math.min(p.y, q.y));
  return { x, y, w: Math.round(Math.abs(q.x - p.x)), h: Math.round(Math.abs(q.y - p.y)) };
}

// ---- state changes ---------------------------------------------------------------------------------------

export function rotateBy(state: EditState, quarterTurns: 1 | -1): EditState {
  const rotation = ((state.rotation + quarterTurns * 90 + 360) % 360) as Rotation;
  // A size the person chose stays theirs: turning the picture swaps its width and height.
  const resize = state.resize ? { w: state.resize.h, h: state.resize.w } : null;
  return { ...state, rotation, resize };
}

export function flipHorizontal(state: EditState): EditState {
  return { ...state, flipH: !state.flipH };
}

export function flipVertical(state: EditState): EditState {
  return { ...state, flipV: !state.flipV };
}

// Applying a crop starts the size from the new natural size: a size typed for the old shape would
// stretch the new one.
export function withCrop(state: EditState, crop: Rect | null, srcW: number, srcH: number): EditState {
  const full = !crop || (crop.x === 0 && crop.y === 0 && crop.w === srcW && crop.h === srcH);
  return { ...state, crop: full ? null : clampRectTo(crop, { w: srcW, h: srcH }), resize: null };
}

export function withAdjustments(state: EditState, brightness: number, contrast: number): EditState {
  const clamp = (v: number) => Math.max(-100, Math.min(100, Math.round(v)));
  return { ...state, brightness: clamp(brightness), contrast: clamp(contrast) };
}

// Sets one side of the size. With the aspect locked the other side follows the picture's natural shape.
export function withResize(state: EditState, srcW: number, srcH: number, change: { w?: number; h?: number }, lockAspect: boolean): EditState {
  const g = geometry(srcW, srcH, { ...state, resize: null });
  const ratio = g.rotW / g.rotH;
  const cur = state.resize ?? { w: g.rotW, h: g.rotH };
  let w = cur.w;
  let h = cur.h;
  if (change.w !== undefined) {
    w = clampSide(change.w);
    if (lockAspect) h = clampSide(w / ratio);
  } else if (change.h !== undefined) {
    h = clampSide(change.h);
    if (lockAspect) w = clampSide(h * ratio);
  }
  if (w === g.rotW && h === g.rotH) return { ...state, resize: null };
  return { ...state, resize: { w, h } };
}

function clampSide(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(1, Math.min(LIMITS.maxSide, Math.round(v)));
}

// A size problem to tell the person about before anything is drawn, or null when it can be exported.
export function outputProblem(outW: number, outH: number): "too_large" | null {
  if (outW > LIMITS.maxSide || outH > LIMITS.maxSide || outW * outH > LIMITS.maxOutputPixels) return "too_large";
  return null;
}

// True when the final picture has more pixels than the kept part of the original: nothing can add the
// missing detail, so the person is warned.
export function isUpscaled(srcW: number, srcH: number, state: EditState): boolean {
  const g = geometry(srcW, srcH, state);
  return g.outW > g.rotW || g.outH > g.rotH;
}

// Brightness and contrast as the scanner's page editor uses them (utils/scanner/enhance.ts applyAdjustments):
// the lookup table for one 8-bit channel. Exposed so tests can check an export against the same curve.
export function adjustmentCurve(brightness: number, contrast: number): Uint8ClampedArray {
  const scale = 1.5;
  const c = Math.max(-100, Math.min(100, contrast)) * scale;
  const offset = Math.max(-100, Math.min(100, brightness)) * scale;
  const factor = (259 * (c + 255)) / (255 * (259 - c));
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = factor * (v - 128) + 128 + offset;
  return lut;
}
