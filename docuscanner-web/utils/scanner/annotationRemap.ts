// Keeps annotations attached to the same spot on the DOCUMENT when the page's
// geometry changes (crop turned on/off/adjusted, page rotated). Annotations are
// stored relative to the processed page image, and that image is derived from
// the original photo by: crop (a perspective warp) -> rotate -> resize. So to
// move a mark from one geometry to another we map it back to the original photo
// (which never changes) and forward again through the new geometry.
//
// Pure math, no DOM, so it can be tested in isolation.

import { distance, type Point, type Quad } from "./geometry";
import { solveHomography } from "./perspective";
import type { Annotation, Bounds } from "./annotations";

export type Rotation = 0 | 90 | 180 | 270;

// The parts of a page that decide its processed shape.
export interface PageGeometry {
  originalWidth: number;
  originalHeight: number;
  quad: Quad | null;
  cropEnabled: boolean;
  rotation: Rotation;
}

// Same rule as pageProcessing.renderPage for the cropped size.
const MIN_CROP_SIDE = 100;

interface Mapper {
  // Processed page size before the final size cap (only ratios matter).
  width: number;
  height: number;
  toOriginal: (u: number, v: number) => Point;
  fromOriginal: (x: number, y: number) => [number, number];
}

type Matrix3 = [number, number, number, number, number, number, number, number, number];

function invert3(m: Matrix3): Matrix3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

// Processed (normalized, after rotation) -> normalized before the rotation.
function unrotate(rotation: Rotation, u: number, v: number): [number, number] {
  if (rotation === 90) return [v, 1 - u];
  if (rotation === 270) return [1 - v, u];
  if (rotation === 180) return [1 - u, 1 - v];
  return [u, v];
}

function rotate(rotation: Rotation, x: number, y: number): [number, number] {
  if (rotation === 90) return [1 - y, x];
  if (rotation === 270) return [y, 1 - x];
  if (rotation === 180) return [1 - x, 1 - y];
  return [x, y];
}

function makeMapper(g: PageGeometry): Mapper | null {
  const swap = g.rotation === 90 || g.rotation === 270;

  if (g.cropEnabled && g.quad) {
    const [tl, tr, , bl] = g.quad;
    const outW = Math.max(MIN_CROP_SIDE, Math.round(distance(tl, tr)));
    const outH = Math.max(MIN_CROP_SIDE, Math.round(distance(tl, bl)));
    const dst: Point[] = [
      { x: 0, y: 0 },
      { x: outW, y: 0 },
      { x: outW, y: outH },
      { x: 0, y: outH },
    ];
    // Maps a pixel of the cropped image to the original photo (the same
    // transform the warp itself samples with).
    const h = solveHomography(dst, g.quad);
    if (!h || h.some((n) => !Number.isFinite(n))) return null;
    const forward: Matrix3 = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
    const inverse = invert3(forward);
    if (!inverse) return null;

    return {
      width: swap ? outH : outW,
      height: swap ? outW : outH,
      toOriginal(u, v) {
        const [cu, cv] = unrotate(g.rotation, u, v);
        const x = cu * outW;
        const y = cv * outH;
        const w = forward[6] * x + forward[7] * y + 1;
        return { x: (forward[0] * x + forward[1] * y + forward[2]) / w, y: (forward[3] * x + forward[4] * y + forward[5]) / w };
      },
      fromOriginal(x, y) {
        const w = inverse[6] * x + inverse[7] * y + inverse[8];
        const dx = (inverse[0] * x + inverse[1] * y + inverse[2]) / w;
        const dy = (inverse[3] * x + inverse[4] * y + inverse[5]) / w;
        return rotate(g.rotation, dx / outW, dy / outH);
      },
    };
  }

  const w = g.originalWidth;
  const h = g.originalHeight;
  return {
    width: swap ? h : w,
    height: swap ? w : h,
    toOriginal(u, v) {
      const [cu, cv] = unrotate(g.rotation, u, v);
      return { x: cu * w, y: cv * h };
    },
    fromOriginal(x, y) {
      return rotate(g.rotation, x / w, y / h);
    },
  };
}

export function sameGeometry(a: PageGeometry, b: PageGeometry): boolean {
  if (a.rotation !== b.rotation) return false;
  const aCrop = a.cropEnabled && a.quad;
  const bCrop = b.cropEnabled && b.quad;
  if (!aCrop && !bCrop) return true;
  if (!aCrop || !bCrop) return false;
  return a.quad!.every((p, i) => p.x === b.quad![i].x && p.y === b.quad![i].y);
}

// Canvas pixels per original-photo pixel around an original point: how much the
// content is magnified in this geometry there.
function localScale(m: Mapper, o: Point): number {
  const [u0, v0] = m.fromOriginal(o.x, o.y);
  const [u1, v1] = m.fromOriginal(o.x + 1, o.y);
  const [u2, v2] = m.fromOriginal(o.x, o.y + 1);
  const ax = Math.hypot((u1 - u0) * m.width, (v1 - v0) * m.height);
  const ay = Math.hypot((u2 - u0) * m.width, (v2 - v0) * m.height);
  const scale = Math.sqrt(ax * ay);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

export interface RemapBounds {
  // Normalized bounds of what an annotation visibly fills, for a page of the
  // given (canonical) pixel size -- text width and height depend on wrapping,
  // which only the renderer can measure.
  (annotation: Annotation, pageWidth: number, pageHeight: number): Bounds;
}

// Returns the annotations positioned for `to`, keeping each attached to the
// same spot of the document. Pen strokes and highlights are part of the drawing
// and follow it (a stroke bends with a perspective crop); text, signatures and
// stamps keep their upright orientation and move/scale as a whole. Returns the
// input array itself when nothing changed.
export function remapAnnotations(
  annotations: Annotation[],
  from: PageGeometry,
  to: PageGeometry,
  boundsOf: RemapBounds,
): Annotation[] {
  if (annotations.length === 0 || sameGeometry(from, to)) return annotations;
  const src = makeMapper(from);
  const dst = makeMapper(to);
  if (!src || !dst) return annotations;

  const mapPoint = (u: number, v: number): [number, number] => {
    const o = src.toOriginal(u, v);
    return dst.fromOriginal(o.x, o.y);
  };
  // How much bigger (or smaller) content appears in `to` than in `from` at a point.
  const ratioAt = (u: number, v: number): number => {
    const o = src.toOriginal(u, v);
    return localScale(dst, o) / localScale(src, o);
  };

  return annotations.map((annotation): Annotation => {
    switch (annotation.type) {
      case "ink": {
        const points = annotation.points.map(([x, y]) => mapPoint(x, y));
        const mid = annotation.points[Math.floor(annotation.points.length / 2)];
        const ratio = ratioAt(mid[0], mid[1]);
        return { ...annotation, points, width: (annotation.width * src.width * ratio) / dst.width };
      }
      case "highlight": {
        const corners = [
          mapPoint(annotation.x, annotation.y),
          mapPoint(annotation.x + annotation.w, annotation.y),
          mapPoint(annotation.x + annotation.w, annotation.y + annotation.h),
          mapPoint(annotation.x, annotation.y + annotation.h),
        ];
        const xs = corners.map((c) => c[0]);
        const ys = corners.map((c) => c[1]);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return { ...annotation, x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
      }
      case "text":
      case "check":
      case "cross":
      case "signature": {
        const b = boundsOf(annotation, src.width, src.height);
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        const [nx, ny] = mapPoint(cx, cy);
        const ratio = ratioAt(cx, cy);
        const w = (b.w * src.width * ratio) / dst.width;
        const h = (b.h * src.height * ratio) / dst.height;
        if (annotation.type === "text") {
          // `b` is the box the letters fill, so that is what stays centered on
          // the spot; the (possibly wider) wrapping box just scales along.
          return {
            ...annotation,
            x: nx - w / 2,
            y: ny - h / 2,
            w: (annotation.w * src.width * ratio) / dst.width,
            size: (annotation.size * src.width * ratio) / dst.width,
          };
        }
        return { ...annotation, x: nx - w / 2, y: ny - h / 2, w, h };
      }
    }
  });
}
