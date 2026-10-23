// Reads a .docx the way an independent consumer would: unzip, parse every XML part, resolve
// relationships, and report paragraphs/runs/pictures. Used to check what the creator REALLY exported.
import { createRequire } from "node:module";
import crypto from "node:crypto";
const require = createRequire(import.meta.url);
const JSZip = require("jszip");
const { DOMParser } = require("@xmldom/xmldom");

export const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const kids = (el, name) => Array.from(el.childNodes).filter((n) => n.nodeType === 1 && n.localName === name);
const kid = (el, name) => (el ? (kids(el, name)[0] ?? null) : null);
const attr = (el, name) => (el ? el.getAttributeNS(W, name) || el.getAttribute("w:" + name) || null : null);
const on = (el) => !!el && attr(el, "val") !== "false" && attr(el, "val") !== "0";

export async function readDocx(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const parts = {};
  const errors = [];
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir) continue;
    if (/\.(xml|rels)$/.test(name)) {
      const text = await zip.file(name).async("string");
      parts[name] = new DOMParser({ onError: (lvl, msg) => lvl !== "warning" && errors.push(`${name}: ${msg}`) }).parseFromString(text, "text/xml");
    }
  }
  const rels = {};
  const relDoc = parts["word/_rels/document.xml.rels"];
  for (const r of Array.from(relDoc?.getElementsByTagName("Relationship") ?? [])) {
    rels[r.getAttribute("Id")] = { type: r.getAttribute("Type").split("/").pop(), target: r.getAttribute("Target"), external: r.getAttribute("TargetMode") === "External" };
  }
  const doc = parts["word/document.xml"];
  const body = doc.getElementsByTagNameNS(W, "body")[0];

  const readRun = (r, link) => {
    const rPr = kid(r, "rPr");
    const sz = kid(rPr, "sz");
    const shd = kid(rPr, "shd");
    let text = "";
    let image = null;
    for (const c of Array.from(r.childNodes)) {
      if (c.nodeType !== 1) continue;
      if (c.localName === "t") text += c.textContent;
      else if (c.localName === "tab") text += "\t";
      else if (c.localName === "br") text += "\n";
      else if (c.localName === "drawing") {
        const blip = c.getElementsByTagNameNS(A, "blip")[0];
        const ext = c.getElementsByTagNameNS(WP, "extent")[0];
        const docPr = c.getElementsByTagNameNS(WP, "docPr")[0];
        const rid = blip?.getAttributeNS(R, "embed") || blip?.getAttribute("r:embed");
        image = { rid, target: rels[rid]?.target, widthPx: Math.round(Number(ext.getAttribute("cx")) / 9525), heightPx: Math.round(Number(ext.getAttribute("cy")) / 9525), descr: docPr?.getAttribute("descr") ?? "" };
      }
    }
    return {
      text,
      image,
      link,
      bold: on(kid(rPr, "b")),
      italic: on(kid(rPr, "i")),
      underline: !!kid(rPr, "u") && attr(kid(rPr, "u"), "val") !== "none",
      strike: on(kid(rPr, "strike")),
      sup: attr(kid(rPr, "vertAlign"), "val") === "superscript",
      sub: attr(kid(rPr, "vertAlign"), "val") === "subscript",
      font: attr(kid(rPr, "rFonts"), "ascii"),
      sizePt: sz ? Number(attr(sz, "val")) / 2 : null,
      color: attr(kid(rPr, "color"), "val"),
      fill: shd ? attr(shd, "fill") : null,
      style: attr(kid(rPr, "rStyle"), "val"),
    };
  };

  const paragraphs = [];
  for (const p of kids(body, "p")) {
    const pPr = kid(p, "pPr");
    const numPr = kid(pPr, "numPr");
    const spacing = kid(pPr, "spacing");
    const ind = kid(pPr, "ind");
    const runs = [];
    for (const c of Array.from(p.childNodes)) {
      if (c.nodeType !== 1) continue;
      if (c.localName === "r") runs.push(readRun(c));
      else if (c.localName === "hyperlink") {
        const rid = c.getAttributeNS(R, "id") || c.getAttribute("r:id");
        for (const r of kids(c, "r")) runs.push(readRun(r, rels[rid]));
      }
    }
    paragraphs.push({
      text: runs.map((r) => r.text).join(""),
      runs,
      style: attr(kid(pPr, "pStyle"), "val"),
      align: attr(kid(pPr, "jc"), "val"),
      numId: numPr ? attr(kid(numPr, "numId"), "val") : null,
      ilvl: numPr ? Number(attr(kid(numPr, "ilvl"), "val")) : null,
      before: spacing && attr(spacing, "before") !== null ? Number(attr(spacing, "before")) : null,
      after: spacing && attr(spacing, "after") !== null ? Number(attr(spacing, "after")) : null,
      line: spacing && attr(spacing, "line") !== null ? Number(attr(spacing, "line")) : null,
      lineRule: spacing ? attr(spacing, "lineRule") : null,
      indentLeft: ind && attr(ind, "left") !== null ? Number(attr(ind, "left")) : null,
      indentRight: ind && attr(ind, "right") !== null ? Number(attr(ind, "right")) : null,
      firstLine: ind && attr(ind, "firstLine") !== null ? Number(attr(ind, "firstLine")) : null,
      hanging: ind && attr(ind, "hanging") !== null ? Number(attr(ind, "hanging")) : null,
      pageBreakBefore: !!kid(pPr, "pageBreakBefore"),
      pageBreakRuns: Array.from(p.getElementsByTagNameNS(W, "br")).filter((b) => attr(b, "type") === "page").length,
      border: !!kid(pPr, "pBdr"),
    });
  }
  const sect = kid(body, "sectPr");
  const pgSz = kid(sect, "pgSz");
  const pgMar = kid(sect, "pgMar");
  const page = {
    width: Number(attr(pgSz, "w")),
    height: Number(attr(pgSz, "h")),
    margins: pgMar ? ["top", "right", "bottom", "left"].map((k) => Number(attr(pgMar, k))) : [],
  };
  const media = {};
  for (const name of Object.keys(zip.files)) if (name.startsWith("word/media/") && !zip.files[name].dir) media[name] = new Uint8Array(await zip.file(name).async("uint8array"));
  const types = Array.from(parts["[Content_Types].xml"].getElementsByTagName("Default")).map((d) => d.getAttribute("Extension") + "=" + d.getAttribute("ContentType"));
  return { zip, names: Object.keys(zip.files), parts, errors, rels, paragraphs, page, media, types };
}
