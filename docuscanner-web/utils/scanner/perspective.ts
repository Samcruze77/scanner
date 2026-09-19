"use client";

// Four-point perspective correction, plain canvas + typed arrays. Solves the
// 8-DOF projective transform mapping the destination rectangle back to the
// source quadrilateral (so warping can walk the destination and sample the
// source -- the standard inverse-mapping approach, which avoids holes in the
// output), then bilinear-samples each destination pixel.

import type { Point, Quad } from "./geometry";

function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];

    const pivotVal = M[col][col];
    if (Math.abs(pivotVal) < 1e-10) return null;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col] / pivotVal;
      for (let c = col; c <= n; c++) M[row][c] -= factor * M[col][c];
    }
  }

  return M.map((row, i) => row[n] / row[i]);
}

// Solves for h such that, for each i: src[i] == H * dst[i] (H has h33 = 1).
function solveHomography(dst: Point[], src: Point[]): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: X, y: Y } = dst[i];
    const { x, y } = src[i];
    A.push([X, Y, 1, 0, 0, 0, -X * x, -Y * x]);
    b.push(x);
    A.push([0, 0, 0, X, Y, 1, -X * y, -Y * y]);
    b.push(y);
  }
  return solveLinearSystem(A, b);
}

function bilinearSample(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  x: number,
  y: number,
  out: Uint8ClampedArray,
  outIdx: number,
): void {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, sw - 1);
  const y1 = Math.min(y0 + 1, sh - 1);
  const fx = x - x0;
  const fy = y - y0;

  for (let c = 0; c < 4; c++) {
    const p00 = src[(y0 * sw + x0) * 4 + c];
    const p10 = src[(y0 * sw + x1) * 4 + c];
    const p01 = src[(y1 * sw + x0) * 4 + c];
    const p11 = src[(y1 * sw + x1) * 4 + c];
    const top = p00 + (p10 - p00) * fx;
    const bottom = p01 + (p11 - p01) * fx;
    out[outIdx + c] = top + (bottom - top) * fy;
  }
}

// Returns null (never throws) when the quad is degenerate and correction
// can't be performed safely -- callers should fall back to the original.
export function warpPerspective(
  sourceCanvas: HTMLCanvasElement,
  quad: Quad,
  outWidth: number,
  outHeight: number,
): HTMLCanvasElement | null {
  if (outWidth < 1 || outHeight < 1) return null;

  const sctx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  if (!sctx) return null;

  let srcImageData: ImageData;
  try {
    srcImageData = sctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  } catch {
    return null;
  }

  const dstRect: Point[] = [
    { x: 0, y: 0 },
    { x: outWidth, y: 0 },
    { x: outWidth, y: outHeight },
    { x: 0, y: outHeight },
  ];

  const h = solveHomography(dstRect, quad);
  if (!h || h.some((v) => !Number.isFinite(v))) return null;
  const [h11, h12, h13, h21, h22, h23, h31, h32] = h;

  const outCanvas = document.createElement("canvas");
  outCanvas.width = outWidth;
  outCanvas.height = outHeight;
  const octx = outCanvas.getContext("2d");
  if (!octx) return null;

  const outImageData = octx.createImageData(outWidth, outHeight);
  const srcData = srcImageData.data;
  const sw = sourceCanvas.width;
  const sh = sourceCanvas.height;

  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const denom = h31 * x + h32 * y + 1;
      const sx = (h11 * x + h12 * y + h13) / denom;
      const sy = (h21 * x + h22 * y + h23) / denom;
      const outIdx = (y * outWidth + x) * 4;

      if (sx >= 0 && sx < sw - 1 && sy >= 0 && sy < sh - 1) {
        bilinearSample(srcData, sw, sh, sx, sy, outImageData.data, outIdx);
      } else {
        // Sampling outside the source (a slightly loose quad) -- fill white
        // rather than leaving transparent/black pixels at the page edge.
        outImageData.data[outIdx] = 255;
        outImageData.data[outIdx + 1] = 255;
        outImageData.data[outIdx + 2] = 255;
        outImageData.data[outIdx + 3] = 255;
      }
    }
  }

  octx.putImageData(outImageData, 0, 0);
  return outCanvas;
}
