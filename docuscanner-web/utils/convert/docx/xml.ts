// Small helpers over a DOM Document, written against the lowest common
// denominator (childNodes / localName / attributes) so the same code runs on the
// browser's DOMParser and on @xmldom/xmldom in the Node test harness.

export function parseXml(text: string): Document {
  const Parser = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (!Parser) throw new Error("No XML parser available");
  return new Parser().parseFromString(text, "application/xml");
}

export function kids(el: Element | null | undefined): Element[] {
  const out: Element[] = [];
  if (!el) return out;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1) out.push(n as Element);
  }
  return out;
}

export function child(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).localName === name) return n as Element;
  }
  return null;
}

export function childrenNamed(el: Element | null | undefined, name: string): Element[] {
  return kids(el).filter((k) => k.localName === name);
}

// Attribute by local name, ignoring the namespace prefix (w:val, r:id, ...).
export function attr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  const attrs = el.attributes;
  for (let i = 0; i < attrs.length; i++) {
    const a = attrs[i];
    const local = a.localName ?? a.name.split(":").pop();
    if (local === name) return a.value;
  }
  return null;
}

export function attrNum(el: Element | null | undefined, name: string): number | undefined {
  const v = attr(el, name);
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// A toggle property such as <w:b/> or <w:b w:val="0"/>: undefined when the
// element is absent (inherit), otherwise its on/off state.
export function toggle(parent: Element | null | undefined, name: string): boolean | undefined {
  const el = child(parent, name);
  if (!el) return undefined;
  const v = attr(el, "val");
  if (v === null) return true;
  return !(v === "0" || v === "false" || v === "off");
}

export function textOf(el: Element | null | undefined): string {
  return el?.textContent ?? "";
}

export function descendants(el: Element | null | undefined, name: string, out: Element[] = []): Element[] {
  for (const k of kids(el)) {
    if (k.localName === name) out.push(k);
    descendants(k, name, out);
  }
  return out;
}
