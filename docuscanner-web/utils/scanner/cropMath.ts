// Pure geometry for cropping a page of an imported PDF without turning it into a picture. No DOM, no
// imports, so the PDF writer and the tests share the same answer.
//
// An imported PDF page is shown as a picture of the page (the "rendered frame": the page after its own
// /Rotate, origin top-left, y pointing down). The crop is a quad in that picture's pixels. When the quad
// is an axis-aligned rectangle the same crop can be applied to the real PDF page as a clip box, which keeps
// its text and vector drawing; a skewed quad needs a perspective warp, which only pixels can do.

export interface Pt {
  x: number;
  y: number;
}
export type Quadrilateral = [Pt, Pt, Pt, Pt]; // top-left, top-right, bottom-right, bottom-left

// How far a corner may stray from a perfect rectangle (in picture pixels) and still count as one.
export const RECT_TOLERANCE_PX = 1.5;

export interface PxRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// The rectangle the quad describes, or null when the quad is skewed (a real perspective crop).
export function axisAlignedRect(quad: readonly Pt[], tolerancePx = RECT_TOLERANCE_PX): PxRect | null {
  if (quad.length !== 4) return null;
  const [tl, tr, br, bl] = quad;
  const near = (a: number, b: number) => Math.abs(a - b) <= tolerancePx;
  if (!(near(tl.x, bl.x) && near(tr.x, br.x) && near(tl.y, tr.y) && near(bl.y, br.y))) return null;
  const left = (tl.x + bl.x) / 2;
  const right = (tr.x + br.x) / 2;
  const top = (tl.y + tr.y) / 2;
  const bottom = (bl.y + br.y) / 2;
  if (!(right > left && bottom > top)) return null;
  return { left, top, right, bottom };
}

export interface PdfBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UserSpaceBox {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

// Converts a crop rectangle drawn on the picture of the page into the matching box in the PDF page's own
// coordinates (origin bottom-left, y up, before the page's /Rotate). `sourceRotation` is the page's own
// /Rotate (0/90/180/270); the picture's size in pixels is imgW x imgH.
export function cropToUserSpace(box: PdfBox, sourceRotation: number, rect: PxRect, imgW: number, imgH: number): UserSpaceBox {
  const rot = ((Math.round(sourceRotation / 90) * 90) % 360 + 360) % 360;
  const swapped = rot === 90 || rot === 270;
  const frameW = swapped ? box.height : box.width; // the picture's frame in points
  const frameH = swapped ? box.width : box.height;
  const W = box.width;
  const H = box.height;
  const toUser = (px: number, py: number): Pt => {
    const X = (px / imgW) * frameW;
    const Y = (py / imgH) * frameH;
    let xp: number;
    let yp: number;
    if (rot === 0) {
      xp = X;
      yp = Y;
    } else if (rot === 90) {
      xp = Y;
      yp = H - X;
    } else if (rot === 180) {
      xp = W - X;
      yp = H - Y;
    } else {
      xp = W - Y;
      yp = X;
    }
    return { x: box.x + xp, y: box.y + H - yp };
  };
  const a = toUser(rect.left, rect.top);
  const b = toUser(rect.right, rect.bottom);
  const clampX = (v: number) => Math.min(box.x + W, Math.max(box.x, v));
  const clampY = (v: number) => Math.min(box.y + H, Math.max(box.y, v));
  return {
    left: clampX(Math.min(a.x, b.x)),
    right: clampX(Math.max(a.x, b.x)),
    bottom: clampY(Math.min(a.y, b.y)),
    top: clampY(Math.max(a.y, b.y)),
  };
}

// Why a page of an imported PDF cannot keep its text and vector drawing, or null when it can. The words are
// the ones shown to the person, so the interface and the tests agree.
export type FlattenReason = "enhancement" | "adjustment" | "skewed-crop" | "permanent-crop";

export interface FlattenInput {
  cropEnabled: boolean;
  quad: readonly Pt[] | null;
  cropPermanent?: boolean;
  enhancement: string;
  brightness: number;
  contrast: number;
}

export function flattenReason(p: FlattenInput): FlattenReason | null {
  if (p.enhancement !== "original") return "enhancement";
  if (p.brightness !== 0 || p.contrast !== 0) return "adjustment";
  if (p.cropEnabled && p.quad) {
    if (p.cropPermanent) return "permanent-crop";
    if (!axisAlignedRect(p.quad)) return "skewed-crop";
  }
  return null;
}
