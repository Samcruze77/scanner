export interface Point {
  x: number;
  y: number;
}

// Ordered top-left, top-right, bottom-right, bottom-left.
export type Quad = [Point, Point, Point, Point];

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function polygonArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    area += p1.x * p2.y - p2.x * p1.y;
  }
  return Math.abs(area) / 2;
}

// Orders four arbitrary points into tl/tr/br/bl using the standard
// sum/difference heuristic: top-left has the smallest x+y, bottom-right the
// largest; top-right has the largest x-y, bottom-left the smallest.
export function orderQuadCorners(points: Point[]): Quad {
  const bySum = [...points].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...points].sort((a, b) => a.x - a.y - (b.x - b.y));
  const tl = bySum[0];
  const br = bySum[bySum.length - 1];
  const bl = byDiff[0];
  const tr = byDiff[byDiff.length - 1];
  return [tl, tr, br, bl];
}

export function fullImageQuad(width: number, height: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}
