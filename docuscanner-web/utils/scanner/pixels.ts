// Shared low-level pixel-processing primitives used by detection.ts and
// enhance.ts. Deliberately dependency-free (no OpenCV/CV stack) -- these are
// plain typed-array loops over canvas ImageData, dynamically imported by
// callers so none of this ships in the initial bundle.

export function toGrayscale(imageData: ImageData): Float32Array {
  const { data } = imageData;
  const out = new Float32Array(data.length / 4);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    out[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return out;
}

export function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          sum += src[ny * w + nx];
          count++;
        }
      }
      out[y * w + x] = sum / count;
    }
  }
  return out;
}

const SOBEL_X = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
const SOBEL_Y = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

export function sobelMagnitude(src: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let sx = 0;
      let sy = 0;
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = src[(y + dy) * w + (x + dx)];
          sx += v * SOBEL_X[k];
          sy += v * SOBEL_Y[k];
          k++;
        }
      }
      out[y * w + x] = Math.hypot(sx, sy);
    }
  }
  return out;
}

// Otsu's method: finds the threshold that best separates a value
// distribution into two classes. Used both on Sobel-magnitude (edge vs.
// non-edge) and on grayscale values (ink vs. paper for B&W enhancement).
export function otsuThreshold(values: Float32Array): number {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max <= min) return min;

  const bins = 256;
  const hist = new Array(bins).fill(0);
  const scale = (bins - 1) / (max - min);
  for (const v of values) {
    hist[Math.round((v - min) * scale)]++;
  }

  const total = values.length;
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let thresholdBin = 0;
  for (let i = 0; i < bins; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varBetween > maxVar) {
      maxVar = varBetween;
      thresholdBin = i;
    }
  }
  return min + thresholdBin / scale;
}

export function dilate(binary: Uint8Array, w: number, h: number, iterations: number): void {
  const src = binary;
  for (let it = 0; it < iterations; it++) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let on = 0;
        for (let dy = -1; dy <= 1 && !on; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1 && !on; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= w) continue;
            if (src[ny * w + nx]) on = 1;
          }
        }
        out[y * w + x] = on;
      }
    }
    src.set(out);
  }
}

interface HullPoint {
  x: number;
  y: number;
}

// Andrew's monotone chain convex hull, O(n log n).
export function convexHull(points: HullPoint[]): HullPoint[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;

  const cross = (o: HullPoint, a: HullPoint, b: HullPoint) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: HullPoint[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: HullPoint[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}
