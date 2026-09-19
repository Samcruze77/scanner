// Data model for the annotation/signature layer: text, freehand pen,
// highlights, check marks, crosses and signature images that sit on top of a
// page. Pages stay raster (see page.ts); these are lightweight vector objects
// stored on the page and flattened into the image only when the PDF is made
// (see annotationRender.ts), so they can be moved, resized and undone freely
// and stay with their page when pages are reordered.
//
// All geometry is normalized to the page's *processed* image (after crop and
// rotation), so it doesn't depend on how large the page is drawn: x and width
// are fractions of the page width, y and height fractions of its height.
// Font sizes and pen widths are fractions of the page width. Dependency-free
// (no DOM), so the geometry can be reasoned about and tested in isolation.

export type AnnotationTool =
  | "select"
  | "text"
  | "draw"
  | "highlight"
  | "check"
  | "cross"
  | "date"
  | "signature";

export interface TextAnnotation {
  id: string;
  type: "text";
  // Top-left corner of the box.
  x: number;
  y: number;
  // Box width; the height follows from how the text wraps.
  w: number;
  text: string;
  // Font size as a fraction of page width (see ptToSize / sizeToPt).
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
}

export interface InkAnnotation {
  id: string;
  type: "ink";
  points: [number, number][];
  color: string;
  // Pen width as a fraction of page width.
  width: number;
}

export interface HighlightAnnotation {
  id: string;
  type: "highlight";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface StampAnnotation {
  id: string;
  type: "check" | "cross";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface SignatureAnnotation {
  id: string;
  type: "signature";
  x: number;
  y: number;
  w: number;
  h: number;
  // PNG with a transparent background.
  dataUrl: string;
}

export type Annotation =
  | TextAnnotation
  | InkAnnotation
  | HighlightAnnotation
  | StampAnnotation
  | SignatureAnnotation;

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---- constants ---------------------------------------------------------------

// Font sizes are shown to people in points, relative to an A4 page (595pt
// wide) -- the size the PDF is made at -- and stored as a fraction of width.
export const REFERENCE_PAGE_WIDTH_PT = 595;
export const MIN_TEXT_PT = 6;
export const MAX_TEXT_PT = 96;
export const DEFAULT_TEXT_PT = 16;
export const TEXT_LINE_HEIGHT = 1.25;

// Same stack for on-screen editing and for the exported page, so wrapping
// matches. Every platform has one of these.
export const FONT_STACK = 'Arial, Helvetica, "Liberation Sans", sans-serif';
// Typed signatures: a handwriting face if the device has one, otherwise the
// generic cursive family. The result is baked into an image when applied, so
// it looks the same everywhere afterwards.
export const SIGNATURE_FONT_STACK =
  '"Snell Roundhand", "Segoe Script", "Brush Script MT", "Lucida Handwriting", "Apple Chancery", cursive';

export const PALETTE = ["#111111", "#d32f2f", "#1565c0", "#2e7d32"] as const;
export const HIGHLIGHT_PALETTE = ["#ffeb3b", "#69f0ae", "#ff80ab", "#80d8ff"] as const;

export const PEN_WIDTHS = [
  { label: "Thin", value: 0.0025 },
  { label: "Medium", value: 0.005 },
  { label: "Thick", value: 0.011 },
] as const;

export const MIN_BOX = 0.02;
const MIN_SIGNATURE_WIDTH = 0.05;

export function ptToSize(pt: number): number {
  return pt / REFERENCE_PAGE_WIDTH_PT;
}

export function sizeToPt(size: number): number {
  return Math.round(size * REFERENCE_PAGE_WIDTH_PT);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function newAnnotationId(): string {
  return crypto.randomUUID();
}

// ---- creation ------------------------------------------------------------------

export function todayLabel(): string {
  return new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export interface TextStyle {
  pt: number;
  color: string;
  bold: boolean;
  italic: boolean;
}

export function createText(x: number, y: number, text: string, style: TextStyle): TextAnnotation {
  const w = Math.min(0.42, 1 - x);
  return {
    id: newAnnotationId(),
    type: "text",
    x,
    y,
    w: Math.max(w, 0.1),
    text,
    size: ptToSize(style.pt),
    color: style.color,
    bold: style.bold,
    italic: style.italic,
  };
}

// A stamp is drawn square on screen regardless of the page's aspect ratio, so
// its normalized height depends on the page's shape.
export function createStamp(
  type: "check" | "cross",
  centerX: number,
  centerY: number,
  color: string,
  pageWidth: number,
  pageHeight: number,
): StampAnnotation {
  const w = 0.07;
  const h = (w * pageWidth) / pageHeight;
  return {
    id: newAnnotationId(),
    type,
    x: clamp(centerX - w / 2, 0, 1 - w),
    y: clamp(centerY - h / 2, 0, 1 - h),
    w,
    h,
    color,
  };
}

// Placed centred on the page, sized by its own aspect ratio.
export function createSignature(
  dataUrl: string,
  imageWidth: number,
  imageHeight: number,
  pageWidth: number,
  pageHeight: number,
): SignatureAnnotation {
  const w = 0.32;
  const h = (w * pageWidth * (imageHeight / imageWidth)) / pageHeight;
  return {
    id: newAnnotationId(),
    type: "signature",
    x: clamp(0.5 - w / 2, 0, 1 - w),
    y: clamp(0.62 - h / 2, 0, Math.max(0, 1 - h)),
    w,
    h: Math.min(h, 0.6),
    dataUrl,
  };
}

// ---- editing -------------------------------------------------------------------

export function translateAnnotation<T extends Annotation>(annotation: T, dx: number, dy: number): T {
  if (annotation.type === "ink") {
    return { ...annotation, points: annotation.points.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
  }
  return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
}

// Resizes by dragging the bottom-right handle. `dx`/`dy` are how far the handle
// moved, in normalized units. Text changes width only (its height follows the
// wrapping); highlights resize freely; stamps and signatures keep their shape.
export function resizeAnnotation(
  annotation: Annotation,
  dx: number,
  dy: number,
  pageWidth: number,
  pageHeight: number,
): Annotation {
  switch (annotation.type) {
    case "text":
      return { ...annotation, w: clamp(annotation.w + dx, 0.06, Math.max(0.06, 1 - annotation.x)) };
    case "highlight":
      return {
        ...annotation,
        w: clamp(annotation.w + dx, MIN_BOX, Math.max(MIN_BOX, 1 - annotation.x)),
        h: clamp(annotation.h + dy, MIN_BOX / 2, Math.max(MIN_BOX / 2, 1 - annotation.y)),
      };
    case "check":
    case "cross":
    case "signature": {
      const shape = (annotation.h * pageHeight) / (annotation.w * pageWidth);
      const minW = annotation.type === "signature" ? MIN_SIGNATURE_WIDTH : MIN_BOX;
      const maxW = Math.min(1 - annotation.x, (1 - annotation.y) / ((shape * pageWidth) / pageHeight));
      const w = clamp(annotation.w + dx, minW, Math.max(minW, maxW));
      return { ...annotation, w, h: (w * pageWidth * shape) / pageHeight };
    }
    case "ink":
      return annotation;
  }
}

export function isResizable(annotation: Annotation): boolean {
  return annotation.type !== "ink";
}

// ---- rotation ------------------------------------------------------------------

// Page width/height after rotating a page by `delta` degrees.
export function rotatedDimensions(delta: 90 | 180 | 270, width: number, height: number): [number, number] {
  return delta === 180 ? [width, height] : [height, width];
}

function rotatePoint(x: number, y: number, delta: 90 | 180 | 270): [number, number] {
  if (delta === 90) return [1 - y, x];
  if (delta === 270) return [y, 1 - x];
  return [1 - x, 1 - y];
}

// Keeps annotations attached to the right spot when the page is rotated by
// `delta` degrees clockwise (90 = quarter turn right). Pen strokes and
// highlights are part of the drawing, so they turn with the page. Text,
// signatures and stamps are turned into position only: they keep their
// upright orientation and pixel size so they stay readable. `boundsOf` gives
// an annotation's current normalized bounds (text height depends on wrapping,
// which only the renderer can measure).
export function rotateAnnotations(
  annotations: Annotation[],
  delta: 90 | 180 | 270,
  oldWidth: number,
  oldHeight: number,
  boundsOf: (annotation: Annotation) => Bounds,
): Annotation[] {
  const [newWidth, newHeight] = rotatedDimensions(delta, oldWidth, oldHeight);
  const widthRatio = oldWidth / newWidth;
  const heightRatio = oldHeight / newHeight;

  return annotations.map((annotation): Annotation => {
    switch (annotation.type) {
      case "ink":
        return {
          ...annotation,
          points: annotation.points.map(([x, y]) => rotatePoint(x, y, delta)),
          width: annotation.width * widthRatio,
        };
      case "highlight": {
        const [ax, ay] = rotatePoint(annotation.x, annotation.y, delta);
        const [bx, by] = rotatePoint(annotation.x + annotation.w, annotation.y + annotation.h, delta);
        return {
          ...annotation,
          x: Math.min(ax, bx),
          y: Math.min(ay, by),
          w: Math.abs(bx - ax),
          h: Math.abs(by - ay),
        };
      }
      case "text":
      case "check":
      case "cross":
      case "signature": {
        const b = boundsOf(annotation);
        const [cx, cy] = rotatePoint(b.x + b.w / 2, b.y + b.h / 2, delta);
        const w = b.w * widthRatio;
        const h = b.h * heightRatio;
        if (annotation.type === "text") {
          return { ...annotation, x: cx - w / 2, y: cy - h / 2, w, size: annotation.size * widthRatio };
        }
        return { ...annotation, x: cx - w / 2, y: cy - h / 2, w, h };
      }
    }
  });
}
