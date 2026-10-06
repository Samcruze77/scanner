"use client";

// Document boundary detection, entirely in canvas + typed arrays -- no
// OpenCV/CV dependency. Pipeline: downscale -> grayscale -> blur -> Sobel
// edges -> Otsu threshold -> dilate -> convex hull of edge pixels -> largest
// inscribed quadrilateral. This is a heuristic, not a full contour tracer:
// it works well for a document with reasonable contrast against its
// background (the common phone-photo-on-a-desk case) and is designed to
// report low confidence -- not a wrong answer -- when that assumption
// doesn't hold, so callers can fall back to the original image.

import { convexHull, boxBlur, dilate, otsuThreshold, sobelMagnitude, toGrayscale } from "./pixels";
import { orderQuadCorners, polygonArea, type Point, type Quad } from "./geometry";
import { MAX_DETECTABLE_AREA_RATIO, MIN_DETECTABLE_AREA_RATIO } from "./framing";

export interface DetectionResult {
  quad: Quad;
  confidence: number; // 0..1
}

const WORK_MAX_DIM = 500;
const MIN_EDGE_POINTS = 20;
// The edge hull sits on the page border; grow the quad outward by this fraction
// of its size so the perspective crop never clips content at the page edges.
export const QUAD_SAFETY_MARGIN = 0.012;

function quadFromHull(hull: Point[]): Quad {
  let tl = hull[0];
  let tr = hull[0];
  let br = hull[0];
  let bl = hull[0];
  let minSum = Infinity;
  let maxSum = -Infinity;
  let minDiff = Infinity;
  let maxDiff = -Infinity;

  for (const p of hull) {
    const sum = p.x + p.y;
    const diff = p.x - p.y;
    if (sum < minSum) {
      minSum = sum;
      tl = p;
    }
    if (sum > maxSum) {
      maxSum = sum;
      br = p;
    }
    if (diff < minDiff) {
      minDiff = diff;
      bl = p;
    }
    if (diff > maxDiff) {
      maxDiff = diff;
      tr = p;
    }
  }

  return [tl, tr, br, bl];
}

function expandQuad(quad: Quad, margin: number, maxX: number, maxY: number): Quad {
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  const grow = 1 + margin * 2;
  return quad.map((p) => ({
    x: Math.min(maxX, Math.max(0, cx + (p.x - cx) * grow)),
    y: Math.min(maxY, Math.max(0, cy + (p.y - cy) * grow)),
  })) as Quad;
}

export function detectDocumentQuad(sourceCanvas: HTMLCanvasElement): DetectionResult | null {
  const fullW = sourceCanvas.width;
  const fullH = sourceCanvas.height;
  if (fullW < 10 || fullH < 10) return null;

  const scale = Math.min(1, WORK_MAX_DIM / Math.max(fullW, fullH));
  const w = Math.max(1, Math.round(fullW * scale));
  const h = Math.max(1, Math.round(fullH * scale));

  const work = document.createElement("canvas");
  work.width = w;
  work.height = h;
  const wctx = work.getContext("2d", { willReadFrequently: true });
  if (!wctx) return null;
  wctx.drawImage(sourceCanvas, 0, 0, w, h);

  let imageData: ImageData;
  try {
    imageData = wctx.getImageData(0, 0, w, h);
  } catch {
    return null;
  }

  const gray = toGrayscale(imageData);
  const blurred = boxBlur(gray, w, h, 1);
  const edges = sobelMagnitude(blurred, w, h);
  const edgeThreshold = otsuThreshold(edges);

  const binary = new Uint8Array(w * h);
  for (let i = 0; i < edges.length; i++) {
    binary[i] = edges[i] >= edgeThreshold ? 1 : 0;
  }
  dilate(binary, w, h, 1);

  const points: Point[] = [];
  const stride = 2;
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      if (binary[y * w + x]) points.push({ x, y });
    }
  }
  if (points.length < MIN_EDGE_POINTS) return null;

  const hull = convexHull(points);
  if (hull.length < 4) return null;

  const workQuad = quadFromHull(hull);
  const area = polygonArea(workQuad);
  const areaRatio = area / (w * h);
  if (areaRatio < MIN_DETECTABLE_AREA_RATIO || areaRatio > MAX_DETECTABLE_AREA_RATIO) return null;

  const scaledQuad = workQuad.map((p) => ({ x: p.x / scale, y: p.y / scale })) as Quad;
  const ordered = expandQuad(orderQuadCorners(scaledQuad), QUAD_SAFETY_MARGIN, fullW, fullH);

  // Confidence peaks around a document filling ~55-65% of frame (typical
  // "document on a desk" photo) and tapers off toward the extremes, which
  // are more likely to be noise or a false full-frame match.
  const confidence = Math.max(0.3, Math.min(0.95, 1 - Math.abs(areaRatio - 0.6) * 1.4));

  return { quad: ordered, confidence };
}
