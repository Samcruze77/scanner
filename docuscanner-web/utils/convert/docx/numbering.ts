// numbering.xml: list definitions and the running counters that turn a
// paragraph's (numId, level) into its label ("1.", "a)", "IV.", a bullet, ...).

import type { PPr, RPr } from "./types.ts";
import { parsePPr, parseRPr } from "./styles.ts";
import { attr, attrNum, child, childrenNamed } from "./xml.ts";

export interface NumberingLevel {
  start: number;
  format: string;
  text: string;
  suffix: "tab" | "space" | "nothing";
  ppr: PPr;
  rpr: RPr;
  isLegal: boolean;
  restartAfter?: number; // w:lvlRestart: 0 = never
  pStyle?: string;
}

interface AbstractNum {
  levels: Map<number, NumberingLevel>;
}

export class Numbering {
  private abstracts = new Map<number, AbstractNum>();
  private nums = new Map<number, { abstractId: number; overrides: Map<number, { start?: number; level?: NumberingLevel }> }>();
  private counters = new Map<number, number[]>();
  // Style -> (numId, level) for styles that carry numbering (List Bullet ...).
  styleLinks = new Map<string, { numId: number; ilvl: number }>();

  static parse(doc: Document | null): Numbering {
    const n = new Numbering();
    const root = doc?.documentElement;
    if (!root) return n;
    for (const a of childrenNamed(root, "abstractNum")) {
      const id = attrNum(a, "abstractNumId");
      if (id === undefined) continue;
      const levels = new Map<number, NumberingLevel>();
      for (const l of childrenNamed(a, "lvl")) {
        const level = parseLevel(l);
        const ilvl = attrNum(l, "ilvl") ?? 0;
        levels.set(ilvl, level);
        if (level.pStyle) n.styleLinks.set(level.pStyle, { numId: -1, ilvl });
      }
      n.abstracts.set(id, { levels });
    }
    for (const num of childrenNamed(root, "num")) {
      const numId = attrNum(num, "numId");
      const abstractId = attrNum(child(num, "abstractNumId"), "val");
      if (numId === undefined || abstractId === undefined) continue;
      const overrides = new Map<number, { start?: number; level?: NumberingLevel }>();
      for (const o of childrenNamed(num, "lvlOverride")) {
        const ilvl = attrNum(o, "ilvl") ?? 0;
        const lvl = child(o, "lvl");
        overrides.set(ilvl, {
          start: attrNum(child(o, "startOverride"), "val"),
          level: lvl ? parseLevel(lvl) : undefined,
        });
      }
      n.nums.set(numId, { abstractId, overrides });
    }
    return n;
  }

  level(numId: number, ilvl: number): NumberingLevel | undefined {
    const num = this.nums.get(numId);
    if (!num) return undefined;
    const override = num.overrides.get(ilvl);
    return override?.level ?? this.abstracts.get(num.abstractId)?.levels.get(ilvl);
  }

  // Advances the counters for a numbered paragraph and returns its label.
  next(numId: number, ilvl: number): { label: string; level: NumberingLevel } | null {
    const level = this.level(numId, ilvl);
    if (!level) return null;
    const num = this.nums.get(numId);
    const key = num?.abstractId ?? numId;
    const counters = this.counters.get(key) ?? [];
    this.counters.set(key, counters);

    const startFor = (lvl: number): number => {
      const override = num?.overrides.get(lvl);
      return override?.start ?? this.level(numId, lvl)?.start ?? 1;
    };
    const current = counters[ilvl];
    counters[ilvl] = current === undefined ? startFor(ilvl) : current + 1;
    // A new item at this level restarts every deeper level.
    for (let deeper = ilvl + 1; deeper < counters.length; deeper++) counters[deeper] = undefined as unknown as number;

    if (level.format === "bullet") return { label: level.text, level };
    if (level.format === "none") return { label: "", level };

    const label = level.text.replace(/%([1-9])/g, (_m, digit: string) => {
      const target = Number(digit) - 1;
      const targetLevel = this.level(numId, target);
      let value = counters[target];
      if (value === undefined) {
        value = startFor(target);
        counters[target] = value;
      }
      return formatNumber(value, level.isLegal && target !== ilvl ? "decimal" : (targetLevel?.format ?? "decimal"));
    });
    return { label, level };
  }
}

function parseLevel(l: Element): NumberingLevel {
  const suff = attr(child(l, "suff"), "val");
  return {
    start: attrNum(child(l, "start"), "val") ?? 1,
    format: attr(child(l, "numFmt"), "val") ?? "decimal",
    text: attr(child(l, "lvlText"), "val") ?? "",
    suffix: suff === "space" ? "space" : suff === "nothing" ? "nothing" : "tab",
    ppr: parsePPr(child(l, "pPr")),
    rpr: parseRPr(child(l, "rPr")),
    isLegal: child(l, "isLgl") !== null,
    pStyle: attr(child(l, "pStyle"), "val") ?? undefined,
  };
}

const ROMAN: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

export function formatNumber(value: number, format: string): string {
  switch (format) {
    case "decimal":
      return String(value);
    case "decimalZero":
      return value < 10 ? `0${value}` : String(value);
    case "upperRoman":
    case "lowerRoman": {
      let n = value;
      let out = "";
      for (const [v, s] of ROMAN) {
        while (n >= v) {
          out += s;
          n -= v;
        }
      }
      return format === "upperRoman" ? out : out.toLowerCase();
    }
    case "upperLetter":
    case "lowerLetter": {
      let n = value;
      let out = "";
      while (n > 0) {
        n -= 1;
        out = String.fromCharCode(65 + (n % 26)) + out;
        n = Math.floor(n / 26);
      }
      return format === "upperLetter" ? out : out.toLowerCase();
    }
    case "ordinal":
      return `${value}${value % 100 >= 11 && value % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][value % 10] ?? "th"}`;
    default:
      return String(value);
  }
}
