// Getting a picture file ready to sit in the document. It must end up as PNG or JPEG bytes (the
// formats a Word file can embed), no bigger than the page can use, held as a data URL so it is
// part of the document itself rather than a temporary link. Browser only.
import { CONTENT_WIDTH_PX } from "./model.ts";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
// Plenty for a full-width picture printed at 300 dpi (about 1,850 px); more only makes the file heavy.
export const MAX_IMAGE_SIDE = 2400;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export class ImageProblem extends Error {}

export interface PreparedImage {
  src: string;
  width: number; // display width in CSS px
  alt: string;
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ImageProblem("The picture could not be read."));
    reader.readAsDataURL(blob);
  });
}

export function acceptedImageType(file: Blob): boolean {
  return ACCEPTED.includes(file.type);
}

export async function prepareImage(file: File | Blob): Promise<PreparedImage> {
  if (!acceptedImageType(file)) throw new ImageProblem("Only PNG, JPEG, WebP and GIF pictures can be added.");
  if (file.size > MAX_IMAGE_BYTES) throw new ImageProblem(`That picture is ${(file.size / 1048576).toFixed(1)} MB. Pictures can be up to ${MAX_IMAGE_BYTES / 1048576} MB.`);
  if (file.size === 0) throw new ImageProblem("That picture is empty.");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImageProblem("That file could not be opened as a picture. It may be damaged.");
  }
  try {
    const { width, height } = bitmap;
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(width, height));
    // PNG and JPEG that already fit keep their exact bytes. WebP and GIF are not Word formats, so they are converted.
    const keep = scale === 1 && (file.type === "image/png" || file.type === "image/jpeg");
    let src: string;
    let outWidth = width;
    if (keep) {
      src = await readAsDataUrl(file);
    } else {
      outWidth = Math.max(1, Math.round(width * scale));
      const canvas = document.createElement("canvas");
      canvas.width = outWidth;
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new ImageProblem("This browser could not process the picture.");
      const jpeg = file.type === "image/jpeg";
      if (jpeg) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, jpeg ? "image/jpeg" : "image/png", 0.92));
      if (!blob) throw new ImageProblem("This browser could not process the picture.");
      src = await readAsDataUrl(blob);
    }
    return { src, width: Math.min(outWidth, CONTENT_WIDTH_PX), alt: "" };
  } finally {
    bitmap.close();
  }
}
