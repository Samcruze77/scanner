// Reading picture bytes without a browser: what format they are and how big. The .docx writer
// uses this to embed the picture's real pixels, and the tests use it to check what came out.

export type ImageMime = "image/png" | "image/jpeg" | "image/gif";

export interface SniffedImage {
  mime: ImageMime;
  width: number;
  height: number;
}

export function sniffImage(b: Uint8Array): SniffedImage | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { mime: "image/png", width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { mime: "image/gif", width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      // Start-of-frame markers carry the size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { mime: "image/jpeg", height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return null;
}

// "data:image/png;base64,AAAA" -> bytes. Anything that is not a base64 picture data URL -> null.
export function bytesFromDataUrl(src: unknown): Uint8Array | null {
  if (typeof src !== "string") return null;
  const m = /^data:image\/(?:png|jpeg|jpg|gif);base64,([A-Za-z0-9+/=\s]+)$/.exec(src);
  if (!m) return null;
  const bin = atob(m[1].replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
