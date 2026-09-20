// Draws laid-out pages into a PDF with pdf-lib: real (selectable) text in
// embedded, subsetted fonts, vector shapes and lines, pictures and link
// annotations.

import {
  PDFDocument,
  PDFNumber,
  PDFOperator,
  PDFString,
  beginText,
  clip,
  closePath,
  endPath,
  endText,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setCharacterSpacing,
  setFillingColor,
  setFontAndSize,
  setTextMatrix,
  showText,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { Face, FontStore } from "./fonts.ts";
import type { Cmd } from "./layout.ts";
import type { PageOut } from "./paginate.ts";
import type { ImageRef } from "./model.ts";

export interface RenderOptions {
  title?: string;
  // Converts pictures pdf-lib can't embed (GIF, BMP, WebP ...) to PNG/JPEG.
  convertImage?: (data: Uint8Array, mime: string) => Promise<{ data: Uint8Array; mime: string } | null>;
}

// Ligatures and kerning would change glyphs/advances relative to what layout
// measured (and Word applies neither by default).
const NO_FEATURES = { liga: false, clig: false, kern: false, calt: false, dlig: false, hlig: false } as const;

function hex(color: string): ReturnType<typeof rgb> {
  const c = /^[0-9a-fA-F]{6}$/.test(color) ? color : "000000";
  return rgb(parseInt(c.slice(0, 2), 16) / 255, parseInt(c.slice(2, 4), 16) / 255, parseInt(c.slice(4, 6), 16) / 255);
}

export async function renderPages(pages: PageOut[], fonts: FontStore, options: RenderOptions = {}): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  if (options.title) pdf.setTitle(options.title);
  pdf.setProducer("DocuScanner");
  pdf.setCreator("DocuScanner");

  const warnings = new Set<string>();
  const fontCache = new Map<string, PDFFont>();
  const imageCache = new Map<Uint8Array, PDFImage | null>();

  async function pdfFont(face: Face, subset: number): Promise<PDFFont> {
    const key = `${face.key}#${subset}`;
    let font = fontCache.get(key);
    if (!font) {
      font = await pdf.embedFont(face.subsets[subset].bytes, { subset: true, features: NO_FEATURES as never });
      fontCache.set(key, font);
    }
    return font;
  }

  async function embedImage(image: ImageRef): Promise<PDFImage | null> {
    if (imageCache.has(image.data)) return imageCache.get(image.data) ?? null;
    let result: PDFImage | null = null;
    try {
      let data = image.data;
      let mime = image.mime;
      if (mime !== "image/png" && mime !== "image/jpeg") {
        const converted = options.convertImage ? await options.convertImage(data, mime) : null;
        if (converted) {
          data = converted.data;
          mime = converted.mime;
        } else {
          warnings.add("Some pictures use a format that can't be shown here (for example EMF or WMF) and were left out.");
        }
      }
      if (mime === "image/png") result = await pdf.embedPng(data);
      else if (mime === "image/jpeg") result = await pdf.embedJpg(data);
    } catch {
      warnings.add("A picture could not be read and was left out.");
    }
    imageCache.set(image.data, result);
    return result;
  }

  for (const src of pages) {
    const page = pdf.addPage([src.width, src.height]);
    const H = src.height;
    // Draw in layers: pictures behind text, text and rules, pictures in front.
    for (const list of [src.behind, src.cmds, src.front]) {
      for (const cmd of list) await draw(page, H, cmd);
    }
  }

  async function draw(page: PDFPage, H: number, cmd: Cmd): Promise<void> {
    switch (cmd.k) {
      case "rect":
        page.drawRectangle({ x: cmd.x, y: H - cmd.y - cmd.h, width: cmd.w, height: cmd.h, color: hex(cmd.color) });
        return;
      case "line":
        page.drawLine({
          start: { x: cmd.x1, y: H - cmd.y1 },
          end: { x: cmd.x2, y: H - cmd.y2 },
          thickness: cmd.w,
          color: hex(cmd.color),
          dashArray: cmd.dash,
        });
        return;
      case "shape": {
        const c = hex(cmd.color);
        const s = cmd.size;
        if (cmd.shape === "disc") {
          const r = s * 0.16;
          page.drawCircle({ x: cmd.x + r * 1.3, y: H - cmd.y + s * 0.3, size: r, color: c });
        } else if (cmd.shape === "square") {
          const side = s * 0.28;
          page.drawRectangle({ x: cmd.x + s * 0.06, y: H - cmd.y + s * 0.18, width: side, height: side, color: c });
        } else if (cmd.shape === "arrow") {
          const bx = cmd.x + s * 0.05;
          const by = H - cmd.y + s * 0.1;
          page.drawSvgPath(`M 0 0 L ${s * 0.4} ${s * 0.16} L 0 ${s * 0.32} Z`, { x: bx, y: by + s * 0.32, color: c });
        } else {
          const bx = cmd.x;
          const by = H - cmd.y;
          page.drawLine({ start: { x: bx + s * 0.05, y: by + s * 0.25 }, end: { x: bx + s * 0.2, y: by + s * 0.08 }, thickness: s * 0.08, color: c });
          page.drawLine({ start: { x: bx + s * 0.2, y: by + s * 0.08 }, end: { x: bx + s * 0.5, y: by + s * 0.5 }, thickness: s * 0.08, color: c });
        }
        return;
      }
      case "link": {
        if (!/^(https?:|mailto:)/i.test(cmd.uri)) return;
        const y1 = H - cmd.y - cmd.h;
        const annot = pdf.context.register(
          pdf.context.obj({
            Type: "Annot",
            Subtype: "Link",
            Rect: [cmd.x, y1, cmd.x + cmd.w, y1 + cmd.h],
            Border: [0, 0, 0],
            A: { Type: "Action", S: "URI", URI: PDFString.of(cmd.uri) },
          }),
        );
        page.node.addAnnot(annot);
        return;
      }
      case "image": {
        const embedded = await embedImage(cmd.image);
        if (!embedded) return;
        const crop = cmd.image.crop;
        if (crop && (crop.l || crop.t || crop.r || crop.b)) {
          const visW = 1 - crop.l - crop.r;
          const visH = 1 - crop.t - crop.b;
          if (visW <= 0.01 || visH <= 0.01) return;
          const fullW = cmd.w / visW;
          const fullH = cmd.h / visH;
          const x = cmd.x - crop.l * fullW;
          const yTop = cmd.y - crop.t * fullH;
          page.pushOperators(
            pushGraphicsState(),
            moveTo(cmd.x, H - cmd.y - cmd.h),
            lineTo(cmd.x + cmd.w, H - cmd.y - cmd.h),
            lineTo(cmd.x + cmd.w, H - cmd.y),
            lineTo(cmd.x, H - cmd.y),
            closePath(),
            clip(),
            endPath(),
          );
          page.drawImage(embedded, { x, y: H - yTop - fullH, width: fullW, height: fullH });
          page.pushOperators(popGraphicsState());
        } else {
          page.drawImage(embedded, { x: cmd.x, y: H - cmd.y - cmd.h, width: cmd.w, height: cmd.h });
        }
        return;
      }
      case "text":
        await drawText(page, H, cmd);
        return;
    }
  }

  async function drawText(page: PDFPage, H: number, cmd: Extract<Cmd, { k: "text" }>): Promise<void> {
    const face = cmd.face;
    // Group consecutive characters by the font subset that holds them.
    let x = cmd.x;
    let group = "";
    let owner = -2;
    const flush = async () => {
      if (!group || owner < 0) {
        group = "";
        return;
      }
      const font = await pdfFont(face, owner);
      const width = [...group].reduce((w, ch) => w + face.advance(ch.codePointAt(0) as number) * cmd.size * cmd.scale + cmd.spacing, 0);
      if (cmd.spacing === 0 && cmd.scale === 1) {
        page.drawText(group, { x, y: H - cmd.y, size: cmd.size, font, color: hex(cmd.color) });
      } else {
        const fontKey = page.node.newFontDictionary(font.name, font.ref);
        page.pushOperators(
          pushGraphicsState(),
          setFillingColor(hex(cmd.color)),
          beginText(),
          setFontAndSize(fontKey, cmd.size),
          setCharacterSpacing(cmd.spacing),
          PDFOperator.of("Tz" as never, [PDFNumber.of(cmd.scale * 100)]),
          setTextMatrix(1, 0, 0, 1, x, H - cmd.y),
          showText(font.encodeText(group)),
          endText(),
          popGraphicsState(),
        );
      }
      x += width;
      group = "";
    };
    for (const ch of cmd.text) {
      const cp = ch.codePointAt(0) as number;
      const o = face.subsetOf(cp);
      if (o !== owner) {
        await flush();
        owner = o;
      }
      if (o < 0) {
        x += face.advance(cp) * cmd.size;
        continue;
      }
      group += ch;
    }
    await flush();
  }

  // Yielding to the event loop every few objects (the default) makes big files
  // slow in throttled tabs and buys nothing here.
  const bytes = await pdf.save({ objectsPerTick: 5000 });
  return { bytes, warnings: [...warnings] };
}
