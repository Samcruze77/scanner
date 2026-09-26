// Reads the parts of a .docx package (a zip of XML parts and media) and
// resolves relationships between them.

import JSZip from "jszip";
import { attr, kids, parseXml } from "./xml.ts";

export interface Relationship {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

// Caps that stop a crafted package from exhausting memory: the unzipped size of
// any one part and the number of parts.
const MAX_PART_BYTES = 60 * 1024 * 1024;
const MAX_PARTS = 6000;

export class DocxPackage {
  private zip: JSZip;
  private relCache = new Map<string, Map<string, Relationship>>();

  private constructor(zip: JSZip) {
    this.zip = zip;
  }

  static async open(data: ArrayBuffer | Uint8Array): Promise<DocxPackage> {
    const zip = await JSZip.loadAsync(data);
    if (Object.keys(zip.files).length > MAX_PARTS) throw new Error("too many parts");
    return new DocxPackage(zip);
  }

  // Part names starting with `prefix` (e.g. "word/").
  list(prefix = ""): string[] {
    return Object.keys(this.zip.files).filter((name) => !this.zip.files[name].dir && name.startsWith(prefix));
  }

  has(path: string): boolean {
    return this.zip.file(normalize(path)) !== null;
  }

  async bytes(path: string): Promise<Uint8Array | null> {
    const file = this.zip.file(normalize(path));
    if (!file) return null;
    const data = await file.async("uint8array");
    if (data.length > MAX_PART_BYTES) throw new Error("part too large");
    return data;
  }

  async text(path: string): Promise<string | null> {
    const bytes = await this.bytes(path);
    if (!bytes) return null;
    return new TextDecoder("utf-8").decode(bytes);
  }

  async xml(path: string): Promise<Document | null> {
    const text = await this.text(path);
    // Drop a byte-order mark (built from its code point on purpose).
    return text === null ? null : parseXml(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  }

  // Relationships of one part, e.g. "word/document.xml" reads
  // "word/_rels/document.xml.rels".
  async relationships(partPath: string): Promise<Map<string, Relationship>> {
    const key = normalize(partPath);
    const cached = this.relCache.get(key);
    if (cached) return cached;
    const slash = key.lastIndexOf("/");
    const dir = slash >= 0 ? key.slice(0, slash + 1) : "";
    const file = slash >= 0 ? key.slice(slash + 1) : key;
    const doc = await this.xml(`${dir}_rels/${file}.rels`);
    const map = new Map<string, Relationship>();
    if (doc?.documentElement) {
      for (const rel of kids(doc.documentElement)) {
        const id = attr(rel, "Id");
        const target = attr(rel, "Target");
        if (!id || target === null) continue;
        const external = attr(rel, "TargetMode") === "External";
        map.set(id, {
          id,
          type: attr(rel, "Type") ?? "",
          target: external ? target : resolvePath(dir, target),
          external,
        });
      }
    }
    this.relCache.set(key, map);
    return map;
  }
}

function normalize(path: string): string {
  return path.replace(/^\/+/, "");
}

// "media/image1.png" relative to "word/" -> "word/media/image1.png";
// "../x" and absolute "/x" targets are handled too.
function resolvePath(dir: string, target: string): string {
  if (target.startsWith("/")) return normalize(target);
  const parts = (dir + target).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part !== "." && part !== "") out.push(part);
  }
  return out.join("/");
}
