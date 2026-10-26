"use client";

// The formatting toolbar. Every button works on the current selection: buttons never take focus away
// from the page (mousedown is cancelled), and the controls that must (font size, link address,
// number boxes in a menu) change the document directly, so the selection and the caret stay where they were.
//
// On a wide screen the common controls sit in the bar and the rest open in small panels under their buttons.
// On a phone the bar is two compact rows, and every panel opens as a bottom sheet that stays inside the screen.

import { useEditorState, type Editor } from "@tiptap/react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { fontSizesInSelection } from "./extensions";
import { useMediaQuery } from "./useMediaQuery";
import {
  CONTENT_WIDTH_PX,
  FONTS,
  FONT_SIZES,
  INDENT_STEP_PT,
  LINE_SPACINGS,
  MARGIN_PRESETS,
  MAX_MARGIN_TWIPS,
  MIN_MARGIN_TWIPS,
  PARAGRAPH_STYLES,
  PT_PER_INCH,
  inchesToTwips,
  leftIndentPt,
  marginPreset,
  normalizeLinkInput,
  primaryFont,
  sizeToPt,
  twipsToInches,
  validateMargins,
  type Margins,
} from "@/utils/wordCreator/model";

const COLORS = ["#000000", "#434343", "#7f7f7f", "#c00000", "#ff0000", "#ed7d31", "#ffc000", "#00b050", "#0070c0", "#7030a0", "#ffffff"];
const HIGHLIGHTS = ["#ffff00", "#00ff00", "#00ffff", "#ff99cc", "#ffd966", "#c6e0b4", "#bdd7ee", "#d9d9d9"];

type MenuName = "color" | "highlight" | "link" | "paragraph" | "margins" | "more" | null;

// ---- small pieces -----------------------------------------------------------------------------------------------------------
function Btn({ label, active, disabled, onClick, children, className = "", "data-assistant-id": assistantId, text }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode; className?: string; "data-assistant-id"?: string; text?: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      data-assistant-id={assistantId}
      className={`wc-tbtn ${className}`}
    >
      {children}
      {text && <span className="wc-tbtn-text">{text}</span>}
    </button>
  );
}

const Sep = () => <span className="wc-sep" aria-hidden />;

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

const AlignIcon = ({ kind }: { kind: "left" | "center" | "right" | "justify" }) => (
  <Svg>
    {kind === "left" && <path d="M4 6h16M4 10h10M4 14h16M4 18h10" />}
    {kind === "center" && <path d="M4 6h16M7 10h10M4 14h16M7 18h10" />}
    {kind === "right" && <path d="M4 6h16M10 10h10M4 14h16M10 18h10" />}
    {kind === "justify" && <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />}
  </Svg>
);

// ---- panels: a popover under its button, or a bottom sheet on a phone ---------------------------------------------------------------
interface Anchor {
  el: HTMLElement;
  rect: DOMRect;
}

function useOutsideAndEscape(getEls: () => (HTMLElement | null)[], onClose: () => void) {
  // Always the latest, so a list that opens after the listener was added still counts as "inside".
  const latest = useRef(getEls);
  useEffect(() => {
    latest.current = getEls;
  });
  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (latest.current().some((r) => r?.contains(t))) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
}

function Popover({ anchor, onClose, children, label }: { anchor: Anchor; onClose: () => void; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: anchor.rect.bottom + 4, left: anchor.rect.left, maxHeight: 400 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const vv = window.visualViewport;
    const vw = vv?.width ?? window.innerWidth;
    const vh = vv?.height ?? window.innerHeight;
    const w = el.offsetWidth;
    const left = Math.max(8, Math.min(anchor.rect.left, vw - w - 8));
    const below = vh - anchor.rect.bottom - 12;
    const above = anchor.rect.top - 12;
    // Open upward only when there is clearly more room above than below.
    const up = below < 220 && above > below;
    setPos({ left, top: up ? Math.max(8, anchor.rect.top - 4 - Math.min(el.scrollHeight, above)) : anchor.rect.bottom + 4, maxHeight: Math.max(160, up ? above : below) });
  }, [anchor]);
  useOutsideAndEscape(() => [ref.current, anchor.el], onClose);
  return (
    <div ref={ref} role="dialog" aria-label={label} className="wc-popover" style={{ position: "fixed", top: pos.top, left: pos.left, maxHeight: pos.maxHeight, overflowY: "auto", width: "min(22rem, calc(100vw - 1rem))" }}>
      {children}
    </div>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    // The first control gets focus, so a keyboard or screen-reader user lands inside the sheet.
    ref.current?.querySelector<HTMLElement>("button, input, select")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="wc-sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className="wc-sheet">
        <div className="wc-sheet-head">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <button type="button" className="btn btn-ghost px-3" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="wc-sheet-body">{children}</div>
      </div>
    </div>
  );
}

function Panel({ phone, anchor, title, onClose, children }: { phone: boolean; anchor: Anchor | null; title: string; onClose: () => void; children: ReactNode }) {
  if (phone || !anchor) {
    return (
      <Sheet title={title} onClose={onClose}>
        {children}
      </Sheet>
    );
  }
  return (
    <Popover anchor={anchor} onClose={onClose} label={title}>
      {children}
    </Popover>
  );
}

function Swatches({ colors, onPick, label }: { colors: string[]; onPick: (c: string) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((c) => (
        <button key={c} type="button" className="wc-swatch" style={{ backgroundColor: c }} title={`${label} ${c}`} aria-label={`${label} ${c}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(c)} />
      ))}
    </div>
  );
}

// ---- font size ------------------------------------------------------------------------------------------------------------------------
// Decrease, a size box that is also a list of standard sizes, and increase. The box shows the size at the caret, or "Mixed" when
// the selection holds several sizes (the arrows then move each piece of text one step, so mixed sizes stay different).
function FontSizeControl({ editor, sizes }: { editor: Editor; sizes: number[] }) {
  const labelId = useId();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const mixed = sizes.length > 1;
  const current = sizes[0];
  const options = FONT_SIZES.includes(current) || mixed ? FONT_SIZES : [...FONT_SIZES, current].sort((a, b) => a - b);

  const apply = (pt: number) => {
    // Focus goes back to the page at once (not on the next frame), so the next key press lands in the document.
    editor.view.focus();
    editor.chain().setFontSize(`${pt}pt`).run();
    setDraft(null);
    setOpen(false);
  };
  const commit = (raw: string) => {
    const pt = sizeToPt(raw);
    if (pt && pt >= 1 && pt <= 400) apply(pt);
    else setDraft(null);
  };

  const openList = () => {
    const el = groupRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vv = window.visualViewport;
    const vw = vv?.width ?? window.innerWidth;
    const vh = vv?.height ?? window.innerHeight;
    const width = Math.max(112, Math.min(r.width, vw - 16));
    const below = vh - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 200 && above > below;
    const maxHeight = Math.max(140, Math.min(300, up ? above : below));
    setBox({ left: Math.max(8, Math.min(r.left, vw - width - 8)), top: up ? Math.max(8, r.top - 4 - Math.min(300, maxHeight)) : r.bottom + 4, width, maxHeight });
    setActive(Math.max(0, options.indexOf(current)));
    setOpen(true);
  };
  const closeList = useCallback(() => setOpen(false), []);
  useOutsideAndEscape(() => (open ? [groupRef.current, listRef.current] : []), closeList);

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>("[data-active]")?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  return (
    <div ref={groupRef} role="group" aria-labelledby={labelId} className="wc-fsgroup">
      <span id={labelId} className="wc-grouplabel">
        Font size
      </span>
      <div className="flex items-center">
        <button type="button" className="wc-tbtn" title="Decrease font size" aria-label="Decrease font size" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().changeFontSize(-1).run()}>
          A<span className="text-[10px]">−</span>
        </button>
        <input
          className="wc-select wc-fsinput"
          role="combobox"
          aria-label={mixed ? "Font size in points: mixed sizes selected" : "Font size in points"}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          title="Font size"
          inputMode="decimal"
          autoComplete="off"
          placeholder={mixed ? "Mixed" : undefined}
          value={draft ?? (mixed ? "" : String(current))}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== null && !open && commit(draft)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!open) openList();
              else setActive((i) => Math.max(0, Math.min(options.length - 1, i + (e.key === "ArrowDown" ? 1 : -1))));
            } else if (e.key === "Home" && open) {
              e.preventDefault();
              setActive(0);
            } else if (e.key === "End" && open) {
              e.preventDefault();
              setActive(options.length - 1);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (open && draft === null) apply(options[active]);
              else commit(draft ?? String(current));
            } else if (e.key === "Escape") {
              setDraft(null);
              setOpen(false);
              editor.view.focus();
            }
          }}
        />
        <button
          type="button"
          className="wc-tbtn wc-fscaret"
          title="Choose a font size from the list"
          aria-label="Choose font size from list"
          aria-haspopup="listbox"
          aria-expanded={open}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (open ? setOpen(false) : openList())}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        <button type="button" className="wc-tbtn" title="Increase font size" aria-label="Increase font size" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().changeFontSize(1).run()}>
          A<span className="text-[10px]">+</span>
        </button>
      </div>
      {open && box && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Font sizes"
          className="wc-fslist"
          style={{ position: "fixed", left: box.left, top: box.top, width: box.width, maxHeight: box.maxHeight }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {options.map((n, i) => (
            <li key={n} id={`${listId}-${i}`} role="option" aria-selected={!mixed && n === current} data-active={i === active || undefined}>
              <button type="button" tabIndex={-1} className="wc-fsitem" onClick={() => apply(n)}>
                {n}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- number box used in menus -----------------------------------------------------------------------------------------------------
function NumberField({ label, value, min, max, step, onCommit, id }: { label: string; value: number; min: number; max: number; step: number; onCommit: (n: number) => void; id: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const finish = () => {
    if (draft === null) return;
    const n = Number(draft);
    setDraft(null);
    if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)));
  };
  return (
    <label className="grid gap-1 text-sm" htmlFor={id}>
      {label}
      <input
        id={id}
        className="field"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={draft ?? String(Math.round(value * 100) / 100)}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(n) && n >= min && n <= max) onCommit(n);
        }}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish();
          }
        }}
      />
    </label>
  );
}

// ---- page margins ------------------------------------------------------------------------------------------------------------------
function MarginsPanel({ margins, onApply }: { margins: Margins; onApply: (m: Margins) => void }) {
  const idBase = useId();
  const preset = marginPreset(margins);
  const asInches = (m: Margins) => ({ top: String(twipsToInches(m.top)), right: String(twipsToInches(m.right)), bottom: String(twipsToInches(m.bottom)), left: String(twipsToInches(m.left)) });
  const [custom, setCustom] = useState(asInches(margins));
  const [error, setError] = useState("");
  const apply = () => {
    const check = validateMargins({ top: inchesToTwips(Number(custom.top)), right: inchesToTwips(Number(custom.right)), bottom: inchesToTwips(Number(custom.bottom)), left: inchesToTwips(Number(custom.left)) });
    if (check.ok === false) return setError(check.error);
    setError("");
    onApply(check.margins);
  };
  return (
    <div className="grid gap-3 text-sm">
      <div role="radiogroup" aria-label="Margin presets" className="grid gap-1">
        {MARGIN_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={preset === p.id}
            className="wc-choice"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setError("");
              setCustom(asInches(p.margins));
              onApply(p.margins);
            }}
          >
            <span className="font-medium">{p.label}</span>
            <span className="muted text-xs">
              Top and bottom {twipsToInches(p.margins.top)} in, left and right {twipsToInches(p.margins.left)} in
            </span>
          </button>
        ))}
      </div>
      <fieldset className="grid gap-2 rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
        <legend className="px-1 text-xs font-medium">Custom margins (inches){preset === "custom" ? ", in use" : ""}</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["top", "bottom", "left", "right"] as const).map((side) => (
            <label key={side} className="grid gap-1" htmlFor={`${idBase}-${side}`}>
              {side[0].toUpperCase() + side.slice(1)}
              <input
                id={`${idBase}-${side}`}
                className="field"
                type="number"
                inputMode="decimal"
                min={twipsToInches(MIN_MARGIN_TWIPS)}
                max={twipsToInches(MAX_MARGIN_TWIPS)}
                step={0.05}
                value={custom[side]}
                aria-invalid={!!error}
                onChange={(e) => setCustom({ ...custom, [side]: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    apply();
                  }
                }}
              />
            </label>
          ))}
        </div>
        {error && (
          <p role="alert" className="text-xs" style={{ color: "var(--error-text)" }}>
            {error}
          </p>
        )}
        <button type="button" className="btn btn-secondary min-h-10" onClick={apply}>
          Apply custom margins
        </button>
        <p className="muted text-xs">
          Each margin can be {twipsToInches(MIN_MARGIN_TWIPS)} to {twipsToInches(MAX_MARGIN_TWIPS)} in. The same margins are used in the downloaded Word file.
        </p>
      </fieldset>
    </div>
  );
}

// ---- the toolbar ----------------------------------------------------------------------------------------------------------------------------
export interface ToolbarProps {
  editor: Editor;
  margins: Margins;
  onMargins: (m: Margins) => void;
  onPickImage: () => void;
  onAddSignature: () => void;
  busyImage: boolean;
  // Extra controls the page owns (view, zoom, navigation keys), shown in the More sheet on a phone.
  moreExtras?: ReactNode;
  // The bottom bar of a phone: where it sits, what goes above it (navigation keys) and the page's own buttons (save, download).
  dock?: { setEl?: (el: HTMLDivElement | null) => void; bottom: string; above?: ReactNode; end?: ReactNode };
}

export function Toolbar({ editor, margins, onMargins, onPickImage, onAddSignature, busyImage, moreExtras, dock }: ToolbarProps) {
  const phone = useMediaQuery("(max-width: 767px)");
  const [menu, setMenu] = useState<MenuName>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState("");
  const idBase = useId();

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const ts = e.getAttributes("textStyle");
      const heading = e.getAttributes("heading");
      const para = e.getAttributes("paragraph");
      const block = e.isActive("heading") ? heading : para;
      const style = e.isActive("heading") ? `h${heading.level}` : (para.variant ?? "normal");
      const image = e.isActive("image");
      const def = PARAGRAPH_STYLES.find((p) => p.id === style) ?? PARAGRAPH_STYLES[0];
      return {
        bold: e.isActive("bold"),
        italic: e.isActive("italic"),
        underline: e.isActive("underline"),
        strike: e.isActive("strike"),
        sup: e.isActive("superscript"),
        sub: e.isActive("subscript"),
        link: e.isActive("link"),
        linkHref: (e.getAttributes("link").href as string | undefined) ?? "",
        bullet: e.isActive("bulletList"),
        ordered: e.isActive("orderedList"),
        inList: e.isActive("listItem"),
        image,
        imageAttrs: image ? e.getAttributes("image") : null,
        align: (block.textAlign as string | undefined) ?? "left",
        style,
        font: primaryFont(ts.fontFamily) ?? "Calibri",
        sizes: fontSizesInSelection(e.state),
        color: (ts.color as string | undefined) ?? "#000000",
        highlight: (e.getAttributes("highlight").color as string | undefined) ?? null,
        lineHeight: (block.lineHeight as number | null | undefined) ?? 1.15,
        before: (block.spaceBefore as number | null | undefined) ?? def.spaceBeforePt,
        after: (block.spaceAfter as number | null | undefined) ?? def.spaceAfterPt,
        leftPt: leftIndentPt(block),
        rightPt: (block.indentRight as number | null | undefined) ?? 0,
        firstPt: (block.firstLine as number | null | undefined) ?? 0,
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      };
    },
    equalityFn: (a, b) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b),
  });

  // Buttons: keep the page focused and act on the selection. Menu fields: change the document directly, so the
  // on-screen keyboard is not summoned and the selection stays exactly as it was.
  // The page gets focus straight away (Tiptap's own focus() waits a frame), so a key pressed right after choosing something lands in the document.
  const run = () => {
    editor.view.focus();
    return editor.chain();
  };
  const direct = () => editor.chain();
  const open = (name: Exclude<MenuName, null>, el: HTMLElement | null) => {
    if (el) setAnchor({ el, rect: el.getBoundingClientRect() });
    setMenu((m) => (m === name ? null : name));
  };
  const close = useCallback(() => setMenu(null), []);

  const setAlign = (a: "left" | "center" | "right" | "justify") => {
    if (s.image) {
      if (a !== "justify") run().updatePicture({ align: a }).run();
      return;
    }
    run().setTextAlign(a).run();
  };

  const openLink = (el: HTMLElement | null) => {
    setLinkText(s.linkHref);
    setLinkError("");
    open("link", el);
  };
  const applyLink = () => {
    const href = normalizeLinkInput(linkText);
    if (!href) {
      setLinkError("Enter a web address (like example.com), an email address, or a tel: link.");
      return;
    }
    if (editor.state.selection.empty && !editor.isActive("link")) {
      editor.chain().focus().insertContent({ type: "text", text: href.replace(/^mailto:|^tel:/, ""), marks: [{ type: "link", attrs: { href } }] }).run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    close();
  };

  const indent = (delta: number) => {
    if (s.inList) {
      if (delta > 0) run().sinkListItem("listItem").run();
      else run().liftListItem("listItem").run();
    } else run().changeIndent(delta).run();
  };

  const menuBtn = (name: Exclude<MenuName, null>, label: string, icon: ReactNode, text?: string, attrs?: { "data-assistant-id"?: string }) => (
    <button
      type="button"
      className="wc-tbtn"
      title={label}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={menu === name}
      data-assistant-id={attrs?.["data-assistant-id"]}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => open(name, e.currentTarget)}
    >
      {icon}
      {text && <span className="wc-tbtn-text">{text}</span>}
    </button>
  );

  const styleSelect = (
    <select className="wc-select wc-style-select" aria-label="Paragraph style" data-assistant-id="wc-style" title="Paragraph style" value={s.style} onChange={(e) => run().setBlockStyle(e.target.value as "normal").run()}>
      {PARAGRAPH_STYLES.map((p) => (
        <option key={p.id} value={p.id}>
          {p.label}
        </option>
      ))}
    </select>
  );
  const fontSelect = (
    <select
      className="wc-select"
      aria-label="Font"
      data-assistant-id="wc-font"
      title="Font"
      value={FONTS.some((f) => f.label === s.font) ? s.font : "Calibri"}
      onChange={(e) => {
        const f = FONTS.find((x) => x.label === e.target.value);
        if (f) run().setFontFamily(f.css).run();
      }}
    >
      {FONTS.map((f) => (
        <option key={f.label} value={f.label}>
          {f.label}
        </option>
      ))}
    </select>
  );

  const undoRedo = (
    <>
      <Btn label="Undo (Ctrl+Z)" disabled={!s.canUndo} onClick={() => run().undo().run()}>
        <Svg>
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
        </Svg>
      </Btn>
      <Btn label="Redo (Ctrl+Y)" disabled={!s.canRedo} onClick={() => run().redo().run()}>
        <Svg>
          <path d="m15 14 5-5-5-5" />
          <path d="M20 9H10a6 6 0 0 0 0 12h3" />
        </Svg>
      </Btn>
    </>
  );

  const emphasis = (
    <>
      <Btn label="Bold (Ctrl+B)" active={s.bold} onClick={() => run().toggleBold().run()}>
        <b>B</b>
      </Btn>
      <Btn label="Italic (Ctrl+I)" active={s.italic} onClick={() => run().toggleItalic().run()}>
        <i className="font-serif">I</i>
      </Btn>
      <Btn label="Underline (Ctrl+U)" active={s.underline} onClick={() => run().toggleUnderline().run()}>
        <u>U</u>
      </Btn>
    </>
  );

  const moreText = (
    <>
      <Btn label="Strikethrough" active={s.strike} onClick={() => run().toggleStrike().run()}>
        <s>S</s>
      </Btn>
      <Btn label="Superscript" active={s.sup} onClick={() => run().toggleSuperscript().run()}>
        x<sup className="text-[10px]">2</sup>
      </Btn>
      <Btn label="Subscript" active={s.sub} onClick={() => run().toggleSubscript().run()}>
        x<sub className="text-[10px]">2</sub>
      </Btn>
      {menuBtn(
        "color",
        "Text colour",
        <span className="flex flex-col items-center">
          <span className="font-semibold leading-none">A</span>
          <span className="mt-0.5 block h-1 w-5 rounded-sm border border-black/20" style={{ backgroundColor: s.color }} />
        </span>,
      )}
      {menuBtn(
        "highlight",
        "Highlight colour",
        <span className="flex flex-col items-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m9 11-6 6v3h9l3-3" />
            <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
          </svg>
          <span className="mt-0.5 block h-1 w-5 rounded-sm border border-black/20" style={{ backgroundColor: s.highlight ?? "transparent" }} />
        </span>,
      )}
      <Btn label="Clear text formatting" onClick={() => run().unsetAllMarks().run()}>
        <Svg>
          <path d="M5 5h14M12 5v6M8 19h8M10 11l-3 8" />
          <path d="m16 14 5 5m0-5-5 5" />
        </Svg>
      </Btn>
    </>
  );

  const alignButtons = (
    <>
      <Btn label="Align left" active={s.image ? s.imageAttrs?.align === "left" : s.align === "left"} onClick={() => setAlign("left")}>
        <AlignIcon kind="left" />
      </Btn>
      <Btn label="Align centre" active={s.image ? s.imageAttrs?.align === "center" : s.align === "center"} onClick={() => setAlign("center")}>
        <AlignIcon kind="center" />
      </Btn>
      <Btn label="Align right" active={s.image ? s.imageAttrs?.align === "right" : s.align === "right"} onClick={() => setAlign("right")}>
        <AlignIcon kind="right" />
      </Btn>
      <Btn label="Justify" active={!s.image && s.align === "justify"} disabled={s.image} onClick={() => setAlign("justify")}>
        <AlignIcon kind="justify" />
      </Btn>
    </>
  );

  const listButtons = (
    <>
      <Btn label="Bulleted list" active={s.bullet} onClick={() => run().toggleBulletList().run()}>
        <Svg>
          <path d="M9 6h11M9 12h11M9 18h11" />
          <circle cx="4.5" cy="6" r="1" fill="currentColor" />
          <circle cx="4.5" cy="12" r="1" fill="currentColor" />
          <circle cx="4.5" cy="18" r="1" fill="currentColor" />
        </Svg>
      </Btn>
      <Btn label="Numbered list" active={s.ordered} onClick={() => run().toggleOrderedList().run()}>
        <Svg>
          <path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v4M4 14h3l-3 3h3" />
        </Svg>
      </Btn>
    </>
  );

  const indentButtons = (
    <>
      <Btn label="Decrease indent" onClick={() => indent(-1)}>
        <Svg>
          <path d="M3 6h18M11 10h10M11 14h10M3 18h18M7 9l-4 3 4 3" />
        </Svg>
      </Btn>
      <Btn label="Increase indent" onClick={() => indent(1)}>
        <Svg>
          <path d="M3 6h18M11 10h10M11 14h10M3 18h18M3 9l4 3-4 3" />
        </Svg>
      </Btn>
    </>
  );

  const insertButtons = (
    <>
      <Btn label="Insert image" data-assistant-id="wc-insert-image" disabled={busyImage} onClick={onPickImage}>
        <Svg>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="1.5" />
          <path d="m21 16-5-5-9 9" />
        </Svg>
      </Btn>
      <Btn label="Add page" data-assistant-id="wc-add-page" onClick={() => run().insertPageBreak().run()}>
        <Svg>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
          <path d="M12 11v6M9 14h6" />
        </Svg>
      </Btn>
    </>
  );

  const paragraphIcon = (
    <Svg>
      <path d="M13 4v16M17 4v16M13 4H9.5a4.5 4.5 0 0 0 0 9H13" />
    </Svg>
  );
  const marginsIcon = (
    <Svg>
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <path d="M7 7h10v10H7z" strokeDasharray="2 2" />
    </Svg>
  );
  const linkIcon = (
    <Svg>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </Svg>
  );
  const signatureIcon = (
    <Svg>
      <path d="M3 17c2-5 4-9 6-9s1 6 3 6 2-4 4-4 2 3 5 3" />
      <path d="M3 21h18" />
    </Svg>
  );

  // ---- the panels ----
  const paragraphPanel = (
    <div className="grid gap-4 text-sm">
      <div>
        <p className="panel-title mb-1">Alignment</p>
        <div className="flex flex-wrap gap-1">{alignButtons}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1" htmlFor={`${idBase}-ls`}>
          Line spacing
          <select id={`${idBase}-ls`} className="field" value={String(s.lineHeight)} onChange={(e) => direct().setLineHeight(Number(e.target.value)).run()}>
            {LINE_SPACINGS.map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "Single" : n === 2 ? "Double" : n === 1.15 ? "1.15" : String(n)}
              </option>
            ))}
          </select>
        </label>
        <span />
        <NumberField id={`${idBase}-before`} label="Before (pt)" value={s.before} min={0} max={200} step={1} onCommit={(n) => direct().setParagraphSpacing({ before: n }).run()} />
        <NumberField id={`${idBase}-after`} label="After (pt)" value={s.after} min={0} max={200} step={1} onCommit={(n) => direct().setParagraphSpacing({ after: n }).run()} />
      </div>
      <div>
        <p className="panel-title mb-1">Indentation (inches)</p>
        <div className="grid grid-cols-3 gap-3">
          <NumberField id={`${idBase}-left`} label="Left" value={s.leftPt / PT_PER_INCH} min={0} max={5} step={0.25} onCommit={(n) => direct().setIndents({ left: n * PT_PER_INCH }).run()} />
          <NumberField id={`${idBase}-right`} label="Right" value={s.rightPt / PT_PER_INCH} min={0} max={5} step={0.25} onCommit={(n) => direct().setIndents({ right: n * PT_PER_INCH }).run()} />
          <NumberField id={`${idBase}-first`} label="First line" value={s.firstPt / PT_PER_INCH} min={-5} max={5} step={0.25} onCommit={(n) => direct().setIndents({ firstLine: n * PT_PER_INCH }).run()} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">{indentButtons}</div>
        <p className="muted mt-1 text-xs">First line: a positive number indents the first line, a negative one hangs it. Each step of the indent buttons is {INDENT_STEP_PT / PT_PER_INCH} in.</p>
      </div>
      <div>
        <p className="panel-title mb-1">Lists</p>
        <div className="flex flex-wrap gap-1">{listButtons}</div>
      </div>
    </div>
  );

  const colorPanel = (
    <>
      <Swatches colors={COLORS} label="Text colour" onPick={(c) => run().setColor(c).run()} />
      <div className="mt-3 flex items-center gap-2">
        <label className="text-sm" htmlFor={`${idBase}-color`}>
          Custom
        </label>
        <input id={`${idBase}-color`} type="color" className="h-9 w-14 cursor-pointer rounded border" value={/^#[0-9a-f]{6}$/i.test(s.color) ? s.color : "#000000"} onChange={(e) => run().setColor(e.target.value).run()} />
        <button type="button" className="btn btn-secondary ml-auto min-h-9 px-3" onMouseDown={(e) => e.preventDefault()} onClick={() => run().unsetColor().run()}>
          Automatic
        </button>
      </div>
    </>
  );
  const highlightPanel = (
    <>
      <Swatches colors={HIGHLIGHTS} label="Highlight" onPick={(c) => run().setHighlight({ color: c }).run()} />
      <div className="mt-3 flex items-center gap-2">
        <label className="text-sm" htmlFor={`${idBase}-hl`}>
          Custom
        </label>
        <input id={`${idBase}-hl`} type="color" className="h-9 w-14 cursor-pointer rounded border" defaultValue="#ffff00" onChange={(e) => run().setHighlight({ color: e.target.value }).run()} />
        <button type="button" className="btn btn-secondary ml-auto min-h-9 px-3" onMouseDown={(e) => e.preventDefault()} onClick={() => run().unsetHighlight().run()}>
          No colour
        </button>
      </div>
    </>
  );
  const linkPanel = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        applyLink();
      }}
      className="grid gap-2 text-sm"
    >
      <label className="grid gap-1">
        Web address
        <input className="field" autoFocus type="text" inputMode="url" placeholder="example.com" value={linkText} onChange={(e) => setLinkText(e.target.value)} aria-invalid={!!linkError} aria-describedby={linkError ? `${idBase}-link-error` : undefined} />
      </label>
      {linkError && (
        <p id={`${idBase}-link-error`} role="alert" className="text-xs" style={{ color: "var(--error-text)" }}>
          {linkError}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary min-h-10 px-4">
          {s.link ? "Update link" : "Add link"}
        </button>
        {s.link && (
          <button
            type="button"
            className="btn btn-secondary min-h-10 px-4"
            onClick={() => {
              editor.chain().focus().extendMarkRange("link").unsetLink().run();
              close();
            }}
          >
            Remove link
          </button>
        )}
      </div>
    </form>
  );

  const panelFor = (name: Exclude<MenuName, "more" | null>) => {
    const titles = { color: "Text colour", highlight: "Highlight colour", link: "Insert link", paragraph: "Paragraph", margins: "Page margins" } as const;
    const body = name === "color" ? colorPanel : name === "highlight" ? highlightPanel : name === "link" ? linkPanel : name === "paragraph" ? paragraphPanel : <MarginsPanel margins={margins} onApply={onMargins} />;
    return (
      <Panel phone={phone} anchor={anchor} title={titles[name]} onClose={close}>
        {body}
      </Panel>
    );
  };

  const pictureBar =
    s.image && s.imageAttrs ? (
      <div className="wc-picturebar" role="group" aria-label="Picture options">
        <span className="font-medium">Picture</span>
        {[25, 50, 75, 100].map((pct) => (
          <button key={pct} type="button" className="btn btn-secondary min-h-10 px-3" onMouseDown={(e) => e.preventDefault()} onClick={() => run().updatePicture({ width: Math.round((CONTENT_WIDTH_PX * pct) / 100) }).run()}>
            {pct}% width
          </button>
        ))}
        <label className="flex items-center gap-2">
          <span>Description</span>
          <input
            className="field min-h-10 w-56 max-w-full"
            type="text"
            placeholder="For screen readers"
            defaultValue={(s.imageAttrs.alt as string) ?? ""}
            key={String(s.imageAttrs.src).length + String(s.imageAttrs.alt)}
            onBlur={(e) => editor.chain().focus().updatePicture({ alt: e.target.value.slice(0, 250) }).run()}
          />
        </label>
        <button type="button" className="btn btn-danger min-h-10 px-3" onMouseDown={(e) => e.preventDefault()} onClick={() => run().deleteSelection().run()}>
          Delete picture
        </button>
      </div>
    ) : null;

  // ---- phone: two compact rows and a More sheet ----
  if (phone) {
    return (
      <div className="wc-toolbar wc-toolbar-phone" role="toolbar" aria-label="Formatting" data-assistant-avoid>
        <div className="wc-prow">
          {undoRedo}
          {styleSelect}
          {menuBtn("more", "More formatting and insert options", <span className="text-lg font-bold leading-none">⋯</span>, undefined, { "data-assistant-id": "wc-more" })}
        </div>
        <div className="wc-prow">
          <FontSizeControl editor={editor} sizes={s.sizes} />
          {emphasis}
        </div>
        {pictureBar}
        {dock && (
          <div ref={(el) => dock.setEl?.(el)} className="wc-dock-wrap" data-assistant-avoid style={{ position: "fixed", left: 0, right: 0, bottom: dock.bottom, zIndex: 35 }}>
            {dock.above}
            <div className="wc-dock" style={{ position: "static" }} role="group" aria-label="Main actions">
              {menuBtn("paragraph", "Paragraph", paragraphIcon, "Paragraph", { "data-assistant-id": "wc-paragraph" })}
              <Btn label="Insert image" data-assistant-id="wc-insert-image" text="Image" disabled={busyImage} onClick={onPickImage}>
                <Svg>
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <circle cx="9" cy="10" r="1.5" />
                  <path d="m21 16-5-5-9 9" />
                </Svg>
              </Btn>
              <Btn label="Add page" data-assistant-id="wc-add-page" text="Add page" onClick={() => run().insertPageBreak().run()}>
                <Svg>
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  <path d="M14 3v5h5" />
                  <path d="M12 11v6M9 14h6" />
                </Svg>
              </Btn>
              {dock.end}
            </div>
          </div>
        )}
        {menu === "more" && (
          <Sheet title="More" onClose={close}>
            <div className="grid gap-4 text-sm">
              <div>
                <p className="panel-title mb-1">Font</p>
                {fontSelect}
              </div>
              <div>
                <p className="panel-title mb-1">Text</p>
                <div className="flex flex-wrap gap-1">{moreText}</div>
              </div>
              <div>
                <p className="panel-title mb-1">Insert</p>
                <div className="flex flex-wrap gap-1">
                  <Btn
                    label="Add signature"
                    data-assistant-id="wc-signature"
                    text="Signature"
                    onClick={() => {
                      close();
                      onAddSignature();
                    }}
                  >
                    {signatureIcon}
                  </Btn>
                  <button type="button" className="wc-tbtn" aria-label="Link" title="Link" onMouseDown={(e) => e.preventDefault()} onClick={() => openLink(null)}>
                    {linkIcon}
                    <span className="wc-tbtn-text">Link</span>
                  </button>
                  <Btn
                    label="Horizontal line"
                    text="Line"
                    onClick={() => {
                      close();
                      run().setHorizontalRule().run();
                    }}
                  >
                    <Svg>
                      <path d="M4 12h16" />
                    </Svg>
                  </Btn>
                  <button type="button" className="wc-tbtn" aria-label="Page margins" title="Page margins" data-assistant-id="wc-margins" onMouseDown={(e) => e.preventDefault()} onClick={() => open("margins", null)}>
                    {marginsIcon}
                    <span className="wc-tbtn-text">Page margins</span>
                  </button>
                </div>
              </div>
              {moreExtras}
            </div>
          </Sheet>
        )}
        {menu && menu !== "more" && panelFor(menu)}
      </div>
    );
  }

  // ---- wide screens ----
  return (
    <div className="wc-toolbar" role="toolbar" aria-label="Formatting" aria-orientation="horizontal">
      <div className="wc-bar-row flex flex-wrap items-end gap-x-0.5 gap-y-0.5 p-1">
        <div className="flex items-center">{undoRedo}</div>
        <Sep />
        {styleSelect}
        {fontSelect}
        <FontSizeControl editor={editor} sizes={s.sizes} />
        <Sep />
        <div className="flex items-center">
          {emphasis}
          {moreText}
        </div>
        <Sep />
        <div className="flex items-center">
          {alignButtons}
          {listButtons}
          {indentButtons}
          {menuBtn("paragraph", "Paragraph", paragraphIcon, "Paragraph", { "data-assistant-id": "wc-paragraph" })}
        </div>
        <Sep />
        <div className="flex items-center">
          {insertButtons}
          <Btn label="Add signature" data-assistant-id="wc-signature" onClick={onAddSignature}>
            {signatureIcon}
          </Btn>
          {menuBtn("link", "Link", linkIcon)}
          <Btn label="Horizontal line" onClick={() => run().setHorizontalRule().run()}>
            <Svg>
              <path d="M4 12h16" />
            </Svg>
          </Btn>
        </div>
        <Sep />
        {menuBtn("margins", "Page margins", marginsIcon, "Margins", { "data-assistant-id": "wc-margins" })}
      </div>
      {pictureBar}
      {menu && menu !== "more" && panelFor(menu)}
    </div>
  );
}
