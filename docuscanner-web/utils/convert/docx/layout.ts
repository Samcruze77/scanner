// Paragraph layout: turns a paragraph's runs into positioned lines, following
// Word's rules for line height, indentation, tab stops, alignment and
// justification. Output is a list of draw commands per line, positioned
// relative to the line's top-left corner.

import type { Face, FontStore } from "./fonts.ts";
import type { ImageRef, Inline, Paragraph, RunStyle } from "./model.ts";
import type { Borders, PPr, TabStop } from "./types.ts";

// ---- draw commands -------------------------------------------------------------------

export type Cmd =
  | { k: "text"; x: number; y: number; text: string; face: Face; size: number; color: string; spacing: number; scale: number }
  | { k: "rect"; x: number; y: number; w: number; h: number; color: string }
  | { k: "line"; x1: number; y1: number; x2: number; y2: number; w: number; color: string; dash?: number[] }
  | { k: "image"; x: number; y: number; w: number; h: number; image: ImageRef }
  | { k: "link"; x: number; y: number; w: number; h: number; uri: string }
  | { k: "shape"; shape: "disc" | "square" | "arrow" | "check"; x: number; y: number; size: number; color: string };

export interface LaidLine {
  height: number;
  cmds: Cmd[];
  breakAfter?: "page" | "column";
}

export interface LaidParagraph {
  kind: "p";
  lines: LaidLine[];
  before: number;
  after: number;
  keepNext: boolean;
  keepLines: boolean;
  widowControl: boolean;
  pageBreakBefore: boolean;
  contextual: boolean;
  styleId?: string;
  ppr: PPr;
  // Horizontal extent of the paragraph (indent edges) for borders/shading.
  left: number;
  right: number;
  borders?: Borders;
  shd?: string;
  // Pictures anchored to the paragraph that don't move its text (behind/in front).
  anchors: ImageRef[];
  padTop: number;
  padBottom: number;
  // Set when a neighbour with identical borders makes them one bordered block.
  borderTopOff?: boolean;
  borderBottomOff?: boolean;
}

export interface LayoutEnv {
  fonts: FontStore;
  defaultTab: number; // twips
  compatMode: number;
  pageNumber: string;
  pageCount: string;
  missing: { count: number };
}

const TWIP = 1 / 20;
const AUTO_SPACING_PT = 14;
// Where Word puts the baseline of a line with "exactly" spacing, as a fraction
// of the line height (measured against Word's own output).
const EXACT_BASELINE = 0.8;
// How much of a space a justified line may give up to fit one more word.
const JUSTIFY_SQUEEZE = 0.2;

// ---- text measurement ------------------------------------------------------------------

const SUPERSCRIPT_SCALE = 0.65;
const SUPERSCRIPT_RAISE = 0.35;
const SUBSCRIPT_RAISE = -0.12;
const SMALL_CAPS_SCALE = 0.8;

function isUsable(face: Face, cp: number): boolean {
  return face.subsetOf(cp) >= 0;
}

// Replaces characters the fonts can't show with something close, and counts
// the ones with no substitute.
export function sanitize(face: Face, text: string, env: LayoutEnv): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp === 0xad || cp === 0x200b || cp === 0xfeff || cp === 0x200c || cp === 0x200d || cp < 0x20) continue;
    if (cp === 0x2011) {
      out += "-";
    } else if (isUsable(face, cp)) {
      out += ch;
    } else if (cp === 0x2009 || cp === 0x2002 || cp === 0x2003 || cp === 0x202f || cp === 0x2007 || cp === 0x2008 || cp === 0x200a) {
      out += " ";
    } else {
      const base = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      if (base && [...base].every((c) => isUsable(face, c.codePointAt(0) as number))) out += base;
      else {
        out += "?";
        env.missing.count += 1;
      }
    }
  }
  return out;
}

export function textWidth(face: Face, text: string, size: number, spacing = 0, scale = 1): number {
  let em = 0;
  let n = 0;
  for (const ch of text) {
    em += face.advance(ch.codePointAt(0) as number);
    n += 1;
  }
  return em * size * scale + spacing * n;
}

// ---- tokens ----------------------------------------------------------------------------

interface Tok {
  type: "word" | "space" | "tab" | "br" | "image" | "field";
  text: string;
  style: RunStyle;
  face: Face;
  size: number;
  w: number;
  raise: number;
  link?: string;
  // A line may break after this token without a space (after a hyphen).
  breakAfter?: boolean;
  // Must stay on the same line as the previous token.
  glue?: boolean;
  kind?: "line" | "page" | "column";
  image?: ImageRef;
  // Ascent/descent this token contributes to its line, in points.
  ascent: number;
  descent: number;
}

function faceFor(env: LayoutEnv, style: RunStyle): Face {
  return env.fonts.get(style.family, style.bold, style.italic);
}

function halfPoint(pt: number): number {
  return Math.round(pt * 2) / 2;
}

function effectiveSize(style: RunStyle): { size: number; raise: number } {
  if (style.vert === "super") return { size: halfPoint(style.size * SUPERSCRIPT_SCALE), raise: style.raise + style.size * SUPERSCRIPT_RAISE };
  if (style.vert === "sub") return { size: halfPoint(style.size * SUPERSCRIPT_SCALE), raise: style.raise + style.size * SUBSCRIPT_RAISE };
  return { size: style.size, raise: style.raise };
}

// Splits text into words and spaces, and words at hyphens (a break is allowed
// after a hyphen that follows a letter).
function splitText(text: string): { text: string; space: boolean; breakAfter: boolean }[] {
  const out: { text: string; space: boolean; breakAfter: boolean }[] = [];
  const re = / +|[^ ]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const part = m[0];
    if (part[0] === " ") {
      out.push({ text: part, space: true, breakAfter: false });
      continue;
    }
    // Break after hyphens/dashes that are followed by more text.
    const pieces = part.match(/[^-–—]*[-–—]+(?=[^-–—])|[^-–—]+|[-–—]+$/g) ?? [part];
    pieces.forEach((piece, i) => {
      const endsWithDash = /[-–—]$/.test(piece) && i < pieces.length - 1 && piece.length > 1;
      out.push({ text: piece, space: false, breakAfter: endsWithDash });
    });
  }
  return out;
}

function textTokens(inline: Extract<Inline, { t: "text" }>, env: LayoutEnv): Tok[] {
  const style = inline.style;
  const face = faceFor(env, style);
  const { size, raise } = effectiveSize(style);
  let text = sanitize(face, inline.text, env);
  if (style.caps) text = text.toUpperCase();
  const tokens: Tok[] = [];
  const spacing = style.charSpacing;

  const push = (t: string, space: boolean, breakAfter: boolean, glue: boolean, sz: number) => {
    const w = textWidth(face, t, sz, spacing, style.scale);
    tokens.push({
      type: space ? "space" : "word",
      text: t,
      style,
      face,
      size: sz,
      w,
      raise,
      link: inline.link,
      breakAfter,
      glue,
      ascent: face.ascent * sz + face.lineGap * sz,
      descent: face.descent * sz,
    });
  };

  for (const part of splitText(text)) {
    if (part.space || !style.smallCaps || style.caps) {
      push(part.text, part.space, part.breakAfter, false, size);
      continue;
    }
    // Small caps: lower-case letters become smaller capitals.
    const runs = part.text.match(/[a-zß-ÿ]+|[^a-zß-ÿ]+/g) ?? [part.text];
    runs.forEach((run, i) => {
      const lower = /^[a-zß-ÿ]/.test(run);
      push(lower ? run.toUpperCase() : run, false, part.breakAfter && i === runs.length - 1, i > 0, lower ? size * SMALL_CAPS_SCALE : size);
    });
  }
  return tokens;
}

// ---- line building ---------------------------------------------------------------------

interface Placed {
  tok: Tok;
  x: number; // relative to the paragraph's text origin
  w: number; // width used (spaces may be stretched)
}

interface TabPlan {
  stops: TabStop[];
  defaultStep: number; // pt
}

function tabStopsFor(ppr: PPr, env: LayoutEnv): TabPlan {
  const stops = (ppr.tabs ?? []).filter((t) => t.kind !== "clear" && t.kind !== "bar").map((t) => ({ ...t, pos: t.pos * TWIP }));
  return { stops: stops.sort((a, b) => a.pos - b.pos), defaultStep: env.defaultTab * TWIP };
}

// The next tab stop strictly after `x` (all in points from the text origin).
function nextStop(x: number, plan: TabPlan, hangingStop: number | null): { pos: number; kind: TabStop["kind"]; leader: TabStop["leader"] } {
  let best: { pos: number; kind: TabStop["kind"]; leader: TabStop["leader"] } | null = null;
  const lastCustom = plan.stops.length ? plan.stops[plan.stops.length - 1].pos : 0;
  for (const s of plan.stops) {
    if (s.pos > x + 0.01) {
      best = { pos: s.pos, kind: s.kind, leader: s.leader };
      break;
    }
  }
  if (hangingStop !== null && hangingStop > x + 0.01 && (!best || hangingStop < best.pos)) {
    best = { pos: hangingStop, kind: "left", leader: "none" };
  }
  if (best) return best;
  // Default stops continue after the last custom stop.
  const step = plan.defaultStep > 0 ? plan.defaultStep : 36;
  const from = Math.max(0, lastCustom);
  let pos = Math.floor(x / step) * step + step;
  if (pos <= x + 0.01) pos += step;
  if (pos < from) pos = Math.ceil(from / step) * step;
  return { pos, kind: "left", leader: "none" };
}

interface BuiltLine {
  placed: Placed[];
  ascent: number;
  descent: number;
  endsWithBreak: boolean;
  breakAfter?: "page" | "column";
  width: number;
  spaceGaps: number;
  labelCmds: Cmd[];
  leaders: { x: number; w: number; leader: TabStop["leader"]; style: RunStyle; face: Face; size: number }[];
}

const EPS = 0.02;

export function layoutParagraph(p: Paragraph, containerWidth: number, env: LayoutEnv): LaidParagraph {
  const ppr = p.ppr;
  const indLeft = (ppr.indLeft ?? 0) * TWIP;
  const indRight = (ppr.indRight ?? 0) * TWIP;
  const hanging = (ppr.indHanging ?? 0) * TWIP;
  const firstLineIndent = (ppr.indFirstLine ?? 0) * TWIP;
  const firstOffset = hanging > 0 ? -hanging : firstLineIndent;
  const textLeftFirst = indLeft + firstOffset;
  const rightEdge = containerWidth - indRight;
  const plan = tabStopsFor(ppr, env);
  const hangingStop = hanging > 0 ? indLeft : null;
  const jc = ppr.jc ?? "left";
  // Word 2013+ lets a justified line fit by squeezing its spaces a little.
  const squeezeRatio = jc === "both" && env.compatMode >= 15 ? JUSTIFY_SQUEEZE : 0;

  // ---- tokens
  const tokens: Tok[] = [];
  const anchors: ImageRef[] = [];
  const blockImages: { image: ImageRef; style: RunStyle }[] = [];
  for (const inline of p.inlines) {
    switch (inline.t) {
      case "text":
        tokens.push(...textTokens(inline, env));
        break;
      case "tab": {
        const face = faceFor(env, inline.style);
        tokens.push({
          type: "tab", text: "", style: inline.style, face, size: inline.style.size, w: 0, raise: 0,
          ascent: face.ascent * inline.style.size + face.lineGap * inline.style.size, descent: face.descent * inline.style.size,
        });
        break;
      }
      case "br": {
        const face = faceFor(env, inline.style);
        tokens.push({
          type: "br", kind: inline.kind, text: "", style: inline.style, face, size: inline.style.size, w: 0, raise: 0,
          ascent: face.ascent * inline.style.size + face.lineGap * inline.style.size, descent: face.descent * inline.style.size,
        });
        break;
      }
      case "field": {
        const face = faceFor(env, inline.style);
        const text = inline.kind === "page" ? env.pageNumber : env.pageCount;
        const { size, raise } = effectiveSize(inline.style);
        tokens.push({
          type: "word", text, style: inline.style, face, size, raise,
          w: textWidth(face, text, size, inline.style.charSpacing, inline.style.scale),
          ascent: face.ascent * size + face.lineGap * size, descent: face.descent * size,
        });
        break;
      }
      case "image": {
        const img = inline.image;
        if (img.anchor && (img.anchor.wrap === "none" || img.anchor.behind)) {
          anchors.push(img);
        } else if (img.anchor) {
          blockImages.push({ image: img, style: inline.style });
        } else {
          const face = faceFor(env, inline.style);
          tokens.push({
            type: "image", text: "", style: inline.style, face, size: inline.style.size, w: img.widthPt, raise: inline.style.raise,
            image: img, ascent: img.heightPt, descent: 0, link: inline.link,
          });
        }
        break;
      }
    }
  }

  // ---- numbering label
  let labelText = "";
  let labelStyle: RunStyle | null = null;
  let labelShape: "disc" | "square" | "arrow" | "check" | null = null;
  let labelSuffix: "tab" | "space" | "nothing" = "tab";
  if (p.numbering) {
    labelSuffix = p.numbering.level.suffix;
    labelStyle = p.numbering.style;
    const raw = p.numbering.label;
    const first = raw.codePointAt(0) ?? 0;
    if (p.numbering.level.format === "bullet" && first >= 0xf000) {
      const font = p.numbering.level.rpr.fonts?.ascii ?? "";
      const code = first & 0xff;
      if (/wingdings/i.test(font)) {
        labelShape = code === 0xd8 || code === 0xf0 ? "arrow" : code === 0xfc || code === 0xfb ? "check" : code === 0xa7 || code === 0xa8 || code === 0x71 || code === 0x6e ? "square" : "disc";
      } else {
        labelShape = code === 0xa7 ? "square" : "disc";
      }
    } else if (p.numbering.level.format === "bullet" && /^[■▪▫□]$/.test(raw)) {
      labelShape = "square";
    } else {
      labelText = raw;
    }
  }

  // ---- lines
  const lines: BuiltLine[] = [];
  let line: BuiltLine = newLine();
  let x = 0; // current x from the text origin
  let firstLine = true;
  let pendingSpaces: Tok[] = [];
  let pendingWidth = 0;
  let lineStart = textLeftFirst;

  function newLine(): BuiltLine {
    return { placed: [], ascent: 0, descent: 0, endsWithBreak: false, width: 0, spaceGaps: 0, labelCmds: [], leaders: [] };
  }

  function startLine(): void {
    firstLine = lines.length === 0;
    lineStart = firstLine ? textLeftFirst : indLeft;
    x = lineStart;
    pendingSpaces = [];
    pendingWidth = 0;
    if (firstLine && (labelText || labelShape) && labelStyle) placeLabel();
  }

  function placeLabel(): void {
    const style = labelStyle as RunStyle;
    const face = faceFor(env, style);
    const size = style.size;
    let labelW: number;
    if (labelShape) {
      labelW = size * (labelShape === "disc" ? 0.42 : 0.5);
      const cmd: Cmd = { k: "shape", shape: labelShape, x, y: 0, size, color: style.color };
      line.labelCmds.push(cmd);
    } else {
      const text = sanitize(face, labelText, env);
      labelW = textWidth(face, text, size, style.charSpacing, style.scale);
      const tok: Tok = {
        type: "word", text, style, face, size, w: labelW, raise: 0,
        ascent: face.ascent * size + face.lineGap * size, descent: face.descent * size,
      };
      line.placed.push({ tok, x, w: labelW });
    }
    line.ascent = Math.max(line.ascent, face.ascent * size + face.lineGap * size);
    line.descent = Math.max(line.descent, face.descent * size);
    x += labelW;
    if (labelSuffix === "tab") {
      const stop = nextStop(x, plan, hangingStop);
      x = stop.pos;
    } else if (labelSuffix === "space") {
      x += textWidth(face, " ", size, 0, 1);
    }
  }

  function finishLine(endsWithBreak: boolean, breakAfter?: "page" | "column"): void {
    line.endsWithBreak = endsWithBreak;
    line.breakAfter = breakAfter;
    // Width used: up to the end of the last non-space item.
    let last = lineStart;
    for (const p of line.placed) if (p.tok.type !== "space") last = Math.max(last, p.x + p.w);
    for (const p of line.placed) if (p.tok.type === "space" && p.x + p.w <= last + EPS) last = Math.max(last, p.x + p.w);
    line.width = last;
    lines.push(line);
    line = newLine();
    startLine();
  }

  startLine();

  const place = (tok: Tok, advance = tok.w) => {
    line.placed.push({ tok, x, w: advance });
    line.ascent = Math.max(line.ascent, tok.ascent + Math.max(0, tok.raise));
    line.descent = Math.max(line.descent, tok.descent + Math.max(0, -tok.raise));
    x += advance;
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok.type === "br") {
      // The break token still counts toward the line's height.
      line.ascent = Math.max(line.ascent, tok.ascent);
      line.descent = Math.max(line.descent, tok.descent);
      if (tok.kind === "line") finishLine(true);
      else finishLine(true, tok.kind);
      continue;
    }

    if (tok.type === "space") {
      pendingSpaces.push(tok);
      pendingWidth += tok.w;
      continue;
    }

    if (tok.type === "tab") {
      const before = x + pendingWidth;
      // Pending spaces before a tab are part of the line.
      for (const s of pendingSpaces) place(s);
      pendingSpaces = [];
      pendingWidth = 0;
      const stop = nextStop(before, plan, hangingStop);
      // Right/centre/decimal stops align the text that follows, up to the next tab.
      let segW = 0;
      if (stop.kind !== "left") {
        for (let j = i + 1; j < tokens.length; j++) {
          const t = tokens[j];
          if (t.type === "tab" || t.type === "br") break;
          if (stop.kind === "decimal" && t.type === "word") {
            const dot = t.text.indexOf(".");
            if (dot >= 0) {
              segW += textWidth(t.face, t.text.slice(0, dot), t.size, t.style.charSpacing, t.style.scale);
              break;
            }
          }
          segW += t.w;
        }
      }
      let target = stop.pos;
      if (stop.kind === "right") target = stop.pos - segW;
      else if (stop.kind === "center") target = stop.pos - segW / 2;
      else if (stop.kind === "decimal") target = stop.pos - segW;
      if (target < before) target = before;
      if (target > rightEdge + EPS && line.placed.length > 0 && stop.kind === "left" && target - before > 0) {
        // A tab that runs past the right margin wraps to the next line.
        finishLine(false);
        continue;
      }
      const from = before;
      const width = target - from;
      line.placed.push({ tok, x: from, w: width });
      if (stop.leader !== "none" && width > 1) {
        line.leaders.push({ x: from, w: width, leader: stop.leader, style: tok.style, face: tok.face, size: tok.size });
      }
      line.ascent = Math.max(line.ascent, tok.ascent);
      line.descent = Math.max(line.descent, tok.descent);
      x = target;
      continue;
    }

    // Words, fields and images occupy width and may wrap.
    const glued: Tok[] = [tok];
    let j = i + 1;
    // Small-caps pieces and text pieces without a space between stay together.
    while (j < tokens.length && (tokens[j].glue || tokens[j - 1].breakAfter === false && isJoined(tokens[j - 1], tokens[j]))) {
      glued.push(tokens[j]);
      j++;
    }
    const groupW = glued.reduce((s, t) => s + t.w, 0);
    const need = pendingWidth + groupW;
    let squeeze = 0;
    if (squeezeRatio > 0) {
      let spaceW = pendingWidth;
      for (const pl of line.placed) if (pl.tok.type === "space") spaceW += pl.w;
      squeeze = spaceW * squeezeRatio;
    }
    const room = rightEdge - x + squeeze;
    const hasContent = line.placed.some((pl) => pl.tok.type !== "space") || line.labelCmds.length > 0;

    if (need > room + EPS && hasContent) {
      // Wrap: the pending spaces stay at the end of the finished line.
      for (const s of pendingSpaces) place(s);
      pendingSpaces = [];
      pendingWidth = 0;
      finishLine(false);
    }
    for (const s of pendingSpaces) place(s);
    pendingSpaces = [];
    pendingWidth = 0;

    const freshLine = !line.placed.some((pl) => pl.tok.type !== "space") && line.labelCmds.length === 0;
    if (freshLine && groupW > rightEdge - x + EPS && glued.length === 1 && tok.type === "word" && tok.text.length > 1) {
      // A single word wider than an empty line breaks anywhere.
      let rest = tok.text;
      while (rest.length > 0) {
        let take = 0;
        let w = 0;
        for (const ch of rest) {
          const cw = textWidth(tok.face, ch, tok.size, tok.style.charSpacing, tok.style.scale);
          if (w + cw > rightEdge - x + EPS && take > 0) break;
          w += cw;
          take += ch.length;
        }
        if (take === 0) take = rest.codePointAt(0)! > 0xffff ? 2 : 1;
        const piece = rest.slice(0, take);
        const pw = textWidth(tok.face, piece, tok.size, tok.style.charSpacing, tok.style.scale);
        place({ ...tok, text: piece, w: pw }, pw);
        rest = rest.slice(take);
        if (rest.length > 0) finishLine(false);
      }
      i = j - 1;
      continue;
    }

    for (const g of glued) place(g);
    i = j - 1;
  }

  // Final line. An otherwise empty paragraph still has one line (its mark). After
  // a trailing page/column break Word does not add an empty line on the next page.
  for (const s of pendingSpaces) place(s);
  const lastBroke = lines.length > 0 && lines[lines.length - 1].breakAfter !== undefined;
  const finalHasContent = line.placed.length > 0 || line.labelCmds.length > 0;
  if (finalHasContent || lines.length === 0 || !lastBroke) {
    if (!finalHasContent) {
      const mark = p.markStyle;
      const face = faceFor(env, mark);
      line.ascent = Math.max(line.ascent, face.ascent * mark.size + face.lineGap * mark.size);
      line.descent = Math.max(line.descent, face.descent * mark.size);
    }
    let last = lineStart;
    for (const pl of line.placed) if (pl.tok.type !== "space") last = Math.max(last, pl.x + pl.w);
    line.width = last;
    line.endsWithBreak = true; // last line of the paragraph: never justified
    lines.push(line);
  }

  // ---- alignment, spacing, commands
  const lineRule = ppr.lineRule ?? "auto";
  const lineVal = ppr.line ?? 240;
  const laid: LaidLine[] = [];

  for (let li = 0; li < lines.length; li++) {
    const b = lines[li];
    const natural = b.ascent + b.descent;
    let ascent = b.ascent;
    let descent = b.descent;
    if (natural === 0) {
      const face = faceFor(env, p.markStyle);
      ascent = face.ascent * p.markStyle.size + face.lineGap * p.markStyle.size;
      descent = face.descent * p.markStyle.size;
    }
    const nat = ascent + descent;
    let height: number;
    let baseline: number;
    if (lineRule === "exact") {
      height = lineVal * TWIP;
      baseline = height * EXACT_BASELINE;
    } else if (lineRule === "atLeast") {
      const min = lineVal * TWIP;
      height = Math.max(nat, min);
      baseline = height > nat ? height - descent : ascent;
    } else {
      const mult = lineVal / 240;
      height = nat * mult;
      baseline = mult >= 1 ? ascent : Math.max(0, height - descent);
    }

    // Horizontal alignment.
    const areaLeft = li === 0 ? textLeftFirst : indLeft;
    const usedRight = b.width;
    const availW = rightEdge - areaLeft;
    let shift = 0;
    let stretch = 0;
    if (jc === "center") shift = (availW - (usedRight - areaLeft)) / 2;
    else if (jc === "right" || jc === "end") shift = availW - (usedRight - areaLeft);
    else if (jc === "both" && !b.endsWithBreak) {
      const gaps = b.placed.filter((pl, idx) => pl.tok.type === "space" && pl.x + pl.w <= usedRight + EPS && idx > 0 && b.placed.slice(0, idx).some((q) => q.tok.type !== "space") && b.placed.slice(idx + 1).some((q) => q.tok.type !== "space" && q.x < usedRight)).length;
      if (gaps > 0) stretch = (rightEdge - usedRight) / gaps;
    }
    if (shift < 0) shift = 0;

    const cmds: Cmd[] = [];
    let extra = 0;
    // Merge neighbouring text of identical style into single commands.
    let run: { x: number; text: string; tok: Tok; end: number } | null = null;
    const flushRun = () => {
      if (!run) return;
      const t = run.tok;
      const y = baseline - t.raise;
      const width = run.end - run.x;
      cmds.push({ k: "text", x: run.x, y, text: run.text, face: t.face, size: t.size, color: t.style.color, spacing: t.style.charSpacing, scale: t.style.scale });
      // Decorations.
      if (t.style.shading || t.style.highlight) {
        cmds.unshift({ k: "rect", x: run.x, y: baseline - ascent, w: width, h: ascent + descent, color: (t.style.highlight ?? t.style.shading) as string });
      }
      const lineW = Math.max(0.5, t.size * 0.05);
      if (t.style.underline) {
        const uy = y + t.size * 0.12;
        cmds.push({ k: "line", x1: run.x, y1: uy, x2: run.x + width, y2: uy, w: lineW, color: t.style.color });
        if (t.style.underline === "double") cmds.push({ k: "line", x1: run.x, y1: uy + lineW * 2, x2: run.x + width, y2: uy + lineW * 2, w: lineW, color: t.style.color });
      }
      if (t.style.strike || t.style.doubleStrike) {
        const sy = y - t.size * 0.28;
        cmds.push({ k: "line", x1: run.x, y1: sy, x2: run.x + width, y2: sy, w: lineW, color: t.style.color });
        if (t.style.doubleStrike) cmds.push({ k: "line", x1: run.x, y1: sy - lineW * 2, x2: run.x + width, y2: sy - lineW * 2, w: lineW, color: t.style.color });
      }
      if (t.link) cmds.push({ k: "link", x: run.x, y: baseline - ascent, w: width, h: ascent + descent, uri: t.link });
      run = null;
    };

    // Spaces between words on a justified line grow.
    const lastContentX = usedRight;
    for (let idx = 0; idx < b.placed.length; idx++) {
      const pl = b.placed[idx];
      const t = pl.tok;
      const px = pl.x + shift + extra;
      let w = pl.w;
      if (t.type === "space") {
        const isGap = stretch > 0 && pl.x + pl.w <= lastContentX + EPS && b.placed.slice(0, idx).some((q) => q.tok.type !== "space") && b.placed.slice(idx + 1).some((q) => q.tok.type !== "space");
        if (isGap) {
          w += stretch;
          extra += stretch;
        }
        // Underlined/highlighted spaces belong to the run around them.
        if (run && sameStyle(run.tok, t) && Math.abs(run.end - px) < 0.05) {
          run.text += t.text;
          run.end = px + w;
          continue;
        }
        if (t.style.underline || t.style.highlight || t.style.shading || t.style.strike) {
          flushRun();
          run = { x: px, text: t.text, tok: t, end: px + w };
          continue;
        }
        flushRun();
        continue;
      }
      if (t.type === "tab") {
        flushRun();
        if (t.style.underline && w > 0) {
          const y = baseline + t.size * 0.12;
          cmds.push({ k: "line", x1: px, y1: y, x2: px + w, y2: y, w: Math.max(0.5, t.size * 0.05), color: t.style.color });
        }
        continue;
      }
      if (t.type === "image" && t.image) {
        flushRun();
        const img = t.image;
        cmds.push({ k: "image", x: px, y: baseline - img.heightPt - t.raise, w: img.widthPt, h: img.heightPt, image: img });
        if (t.link) cmds.push({ k: "link", x: px, y: baseline - img.heightPt, w: img.widthPt, h: img.heightPt, uri: t.link });
        continue;
      }
      // Text.
      if (run && sameStyle(run.tok, t) && Math.abs(run.end - px) < 0.05) {
        run.text += t.text;
        run.end = px + w;
      } else {
        flushRun();
        run = { x: px, text: t.text, tok: t, end: px + w };
      }
    }
    flushRun();

    // Tab leaders.
    for (const lead of b.leaders) {
      const style = lead.style;
      const lx = lead.x + shift;
      const y = baseline - 0;
      if (lead.leader === "underscore") {
        cmds.push({ k: "line", x1: lx, y1: y + lead.size * 0.1, x2: lx + lead.w, y2: y + lead.size * 0.1, w: 0.5, color: style.color });
      } else {
        const ch = lead.leader === "hyphen" ? "-" : lead.leader === "middleDot" ? "·" : ".";
        const cw = lead.face.advance(ch.codePointAt(0) as number) * lead.size;
        const count = Math.floor((lead.w - 2) / (cw || 1));
        if (count > 0) {
          const text = ch.repeat(count);
          cmds.push({ k: "text", x: lx + lead.w - count * cw, y: baseline, text, face: lead.face, size: lead.size, color: style.color, spacing: 0, scale: 1 });
        }
      }
    }
    // List label shapes.
    for (const c of b.labelCmds) {
      if (c.k === "shape") cmds.push({ ...c, x: c.x + shift, y: baseline });
    }

    laid.push({ height, cmds, breakAfter: b.breakAfter });
  }

  // Floating pictures with "top and bottom"/"square" wrapping become their own
  // lines above the text (no text wraps beside them).
  const imageLines: LaidLine[] = blockImages.map(({ image }) => {
    const a = image.anchor;
    const h = image.heightPt;
    let x0 = indLeft;
    const avail = rightEdge - indLeft;
    if (a?.hAlign === "center") x0 = indLeft + (avail - image.widthPt) / 2;
    else if (a?.hAlign === "right") x0 = rightEdge - image.widthPt;
    else if (a) x0 = a.hRel === "page" ? a.hOffsetPt : Math.min(indLeft + a.hOffsetPt, Math.max(0, rightEdge - image.widthPt));
    return { height: h, cmds: [{ k: "image", x: x0, y: 0, w: image.widthPt, h, image }] as Cmd[] };
  });

  // Paragraph borders take room inside the paragraph: the line plus the gap
  // between line and text.
  const bw = (b: { sz: number; space: number; val: string } | undefined): number =>
    b && b.val !== "nil" && b.val !== "none" ? Math.max(0.25, b.sz / 8) + b.space : 0;
  const padTop = bw(ppr.borders?.top);
  const padBottom = bw(ppr.borders?.bottom);
  const allLines = [...imageLines, ...laid];
  if (padTop > 0 && allLines.length > 0) {
    const first = allLines[0];
    first.height += padTop;
    first.cmds = first.cmds.map((c) => (c.k === "line" ? { ...c, y1: c.y1 + padTop, y2: c.y2 + padTop } : { ...c, y: c.y + padTop }));
  }
  if (padBottom > 0 && allLines.length > 0) allLines[allLines.length - 1].height += padBottom;

  const before = ppr.beforeAutospacing ? AUTO_SPACING_PT : (ppr.before ?? 0) * TWIP;
  const after = ppr.afterAutospacing ? AUTO_SPACING_PT : (ppr.after ?? 0) * TWIP;

  return {
    kind: "p",
    lines: allLines,
    before,
    after,
    keepNext: ppr.keepNext ?? false,
    keepLines: ppr.keepLines ?? false,
    widowControl: ppr.widowControl ?? true,
    pageBreakBefore: ppr.pageBreakBefore ?? false,
    contextual: ppr.contextualSpacing ?? false,
    styleId: p.styleId,
    ppr,
    left: indLeft,
    right: rightEdge,
    borders: ppr.borders,
    shd: ppr.shd && ppr.shd !== "auto" ? ppr.shd : undefined,
    anchors,
    padTop,
    padBottom,
  };
}

function isJoined(prev: Tok, next: Tok): boolean {
  // Two word tokens with no space between them (e.g. after a run boundary in
  // the middle of a word, or a hyphen split) must not be separated.
  return prev.type === "word" && next.type === "word" && prev.breakAfter !== true;
}

function sameStyle(a: Tok, b: Tok): boolean {
  const sa = a.style;
  const sb = b.style;
  return (
    a.face === b.face &&
    a.size === b.size &&
    a.raise === b.raise &&
    sa.color === sb.color &&
    sa.underline === sb.underline &&
    sa.strike === sb.strike &&
    sa.doubleStrike === sb.doubleStrike &&
    sa.highlight === sb.highlight &&
    sa.shading === sb.shading &&
    sa.charSpacing === sb.charSpacing &&
    sa.scale === sb.scale &&
    a.link === b.link
  );
}
