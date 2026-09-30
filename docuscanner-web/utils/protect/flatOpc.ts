// Converts an Office "XML Document" file (Flat OPC: what Word, Excel and PowerPoint write for
// File > Save As > "Word XML Document (*.xml)" and the like) into the ordinary Office package
// (.docx, .xlsx, .pptx, ...) it describes, so the package can then be protected.
//
// This is lossless: a Flat OPC file IS the package, written out as one XML document. Each
// <pkg:part> carries a part's name, its content type and either XML (<pkg:xmlData>) or
// base64 bytes (<pkg:binaryData>); the conversion puts every part back into a ZIP and writes
// the [Content_Types].xml that the parts' content types imply.
//
// NOT handled, and refused with a clear message: Word 2003 XML ("WordprocessingML 2003"),
// Excel 2003 XML Spreadsheet, and any other XML. Those are different formats, not packages,
// and converting them to .docx/.xlsx would be a lossy rewrite.
//
// The XML is parsed with the browser's own parser, which fetches nothing; files that declare a
// DOCTYPE or entities are refused outright, so entity-expansion tricks are impossible.

import { detectOfficeExtension, type OfficeExtension } from "./office.ts";
import { ProtectError } from "./protect.ts";

export const MAX_XML_BYTES = 25 * 1024 * 1024;

const PKG = "http://schemas.microsoft.com/office/2006/xmlPackage";
const RELS_TYPE = "application/vnd.openxmlformats-package.relationships+xml";

// True for a Flat OPC document (looks only at the start of the file).
export function looksLikeFlatOpc(text: string): boolean {
  const head = text.slice(0, 8192);
  return /<pkg:package\b/.test(head) && head.includes(PKG);
}

export interface ConvertedPackage {
  bytes: Uint8Array;
  extension: OfficeExtension;
}

interface Dom {
  parse: (xml: string) => Document;
  serialize: (node: Node) => string;
}

function browserDom(): Dom {
  const Parser = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  const Serializer = (globalThis as { XMLSerializer?: typeof XMLSerializer }).XMLSerializer;
  if (!Parser || !Serializer) throw new ProtectError("protect_unsupported_browser");
  return { parse: (xml) => new Parser().parseFromString(xml, "application/xml"), serialize: (node) => new Serializer().serializeToString(node) };
}

export async function flatOpcToPackage(xml: string, dom: Dom = browserDom()): Promise<ConvertedPackage> {
  if (xml.length > MAX_XML_BYTES) throw new ProtectError("protect_too_large");
  if (!looksLikeFlatOpc(xml)) throw new ProtectError("protect_xml_unsupported");
  // No DOCTYPE, no entities: nothing to expand.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ProtectError("protect_invalid");

  let doc: Document;
  try {
    doc = dom.parse(xml);
  } catch {
    throw new ProtectError("protect_invalid");
  }
  const root = doc.documentElement;
  if (!root || root.localName !== "package" || root.namespaceURI !== PKG || doc.getElementsByTagName("parsererror").length > 0) throw new ProtectError("protect_invalid");

  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const overrides: string[] = [];
  const names = new Set<string>();
  let hasRootRels = false;

  for (let node = root.firstChild; node; node = node.nextSibling) {
    if (node.nodeType !== 1 || (node as Element).localName !== "part" || (node as Element).namespaceURI !== PKG) continue;
    const part = node as Element;
    const name = part.getAttributeNS(PKG, "name");
    const contentType = part.getAttributeNS(PKG, "contentType");
    if (!name.startsWith("/") || name.includes("..") || !contentType || names.has(name)) throw new ProtectError("protect_invalid");
    names.add(name);
    if (name === "/_rels/.rels") hasRootRels = true;

    let data: Uint8Array | string | null = null;
    for (let child = part.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (el.namespaceURI !== PKG) continue;
      if (el.localName === "xmlData") {
        const inner = Array.from(el.childNodes).find((n) => n.nodeType === 1);
        if (!inner) throw new ProtectError("protect_invalid");
        data = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${dom.serialize(inner)}`;
      } else if (el.localName === "binaryData") {
        try {
          const binary = atob((el.textContent ?? "").replace(/\s+/g, ""));
          data = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        } catch {
          throw new ProtectError("protect_invalid");
        }
      }
    }
    if (data === null) throw new ProtectError("protect_invalid");
    zip.file(name.slice(1), data);
    // Relationship parts are covered by a Default entry; every other part gets its own Override.
    if (contentType !== RELS_TYPE) overrides.push(`<Override PartName="${name.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" ContentType="${contentType.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"/>`);
  }
  if (!hasRootRels) throw new ProtectError("protect_invalid");

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="${RELS_TYPE}"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join("")}</Types>`;
  const extension = detectOfficeExtension(contentTypes);
  if (extension === null || extension === "ambiguous") throw new ProtectError("protect_xml_unsupported");
  zip.file("[Content_Types].xml", contentTypes);

  // [Content_Types].xml first, as Office writes it.
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { bytes, extension };
}
