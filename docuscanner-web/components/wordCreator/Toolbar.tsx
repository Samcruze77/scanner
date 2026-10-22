"use client";

// The formatting toolbar. Every button works on the current selection: buttons never take focus away
// from the page (mousedown is cancelled), and the controls that must (font size, link address,
// colour picker) hand the selection back with `chain().focus()` before applying anything.

import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CONTENT_WIDTH_PX,
  FONTS,
  FONT_SIZES,
  LINE_SPACINGS,
  PARAGRAPH_STYLES,
  normalizeLinkInput,
  primaryFont,
  sizeToPt,
} from "@/utils/wordCreator/model";

const COLORS = ["#000000", "#434343", "#7f7f7f", "#c00000", "#ff0000", "#ed7d31", "#ffc000", "#00b050", "#0070c0", "#7030a0", "#ffffff"];
const HIGHLIGHTS = ["#ffff00", "#00ff00", "#00ffff", "#ff99cc", "#ffd966", "#c6e0b4", "#bdd7ee", "#d9d9d9"];

type PopoverName = "color" | "highlight" | "link" | "spacing" | null;

function Btn({ label, active, disabled, onClick, children, className = "", "data-assistant-id": assistantId }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode; className?: string; "data-assistant-id"?: string }) {
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

// A small floating panel anchored under its button. Fixed-positioned so a scrolling toolbar can't clip it.
interface Anchor {
  el: HTMLElement;
  rect: DOMRect;
}

function Popover({ anchor, onClose, children, label }: { anchor: Anchor; onClose: () => void; children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = Math.min(320, window.innerWidth - 16);
  const pos = { top: anchor.rect.bottom + 4, left: Math.max(8, Math.min(anchor.rect.left, window.innerWidth - width - 8)) };

  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.el.contains(t)) return;
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
  }, [anchor, onClose]);

  return (
    <div ref={ref} role="dialog" aria-label={label} className="wc-popover" style={{ position: "fixed", top: pos.top, left: pos.left, width: "min(20rem, calc(100vw - 1rem))" }}>
      {children}
    </div>
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

export function Toolbar({ editor, onPickImage, onAddSignature, busyImage }: { editor: Editor; onPickImage: () => void; onAddSignature: () => void; busyImage: boolean }) {
  const [popover, setPopover] = useState<PopoverName>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState("");
  const [sizeDraft, setSizeDraft] = useState<string | null>(null);

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
        sizePt: sizeToPt(ts.fontSize) ?? def.sizePt,
        color: (ts.color as string | undefined) ?? "#000000",
        highlight: (e.getAttributes("highlight").color as string | undefined) ?? null,
        lineHeight: (block.lineHeight as number | null | undefined) ?? 1.15,
        before: (block.spaceBefore as number | null | undefined) ?? def.spaceBeforePt,
        after: (block.spaceAfter as number | null | undefined) ?? def.spaceAfterPt,
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
      };
    },
  });

  const run = () => editor.chain().focus();
  const toggle = (name: Exclude<PopoverName, null>, el: HTMLElement) => {
    setAnchor({ el, rect: el.getBoundingClientRect() });
    setPopover((p) => (p === name ? null : name));
  };
  const close = () => setPopover(null);

  const setAlign = (a: "left" | "center" | "right" | "justify") => {
    if (s.image) {
      if (a !== "justify") run().updatePicture({ align: a }).run();
      return;
    }
    run().setTextAlign(a).run();
  };

  const commitSize = (raw: string) => {
    const pt = sizeToPt(raw);
    setSizeDraft(null);
    if (pt && pt >= 1 && pt <= 400) run().setFontSize(`${pt}pt`).run();
  };

  const openLink = (el: HTMLElement) => {
    setLinkText(s.linkHref);
    setLinkError("");
    toggle("link", el);
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

  const setCell = (field: "before" | "after", raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 200) return;
    run().setParagraphSpacing({ [field]: n }).run();
  };

  return (
    <div className="wc-toolbar" role="toolbar" aria-label="Formatting" aria-orientation="horizontal">
      <div className="wc-bar-row flex flex-wrap items-center gap-x-0.5 gap-y-0.5 p-1">
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
        <Sep />
        <select
          className="wc-select"
          aria-label="Paragraph style"
          data-assistant-id="wc-style"
          title="Paragraph style"
          value={s.style}
          onChange={(e) => {
            run().setBlockStyle(e.target.value as "normal").run();
          }}
        >
          {PARAGRAPH_STYLES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
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
        <input
          className="wc-select w-16 text-center"
          aria-label="Font size in points"
          title="Font size"
          inputMode="decimal"
          list="wc-sizes"
          value={sizeDraft ?? String(s.sizePt)}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const ev = e.nativeEvent as InputEvent;
            setSizeDraft(e.target.value);
            // Picking from the list fires a replacement input; typing digits does not.
            if (!ev.inputType || ev.inputType === "insertReplacementText") commitSize(e.target.value);
          }}
          onBlur={(e) => sizeDraft !== null && commitSize(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitSize(e.currentTarget.value);
              editor.commands.focus();
            } else if (e.key === "Escape") {
              setSizeDraft(null);
              editor.commands.focus();
            }
          }}
        />
        <datalist id="wc-sizes">
          {FONT_SIZES.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <Btn label="Smaller text" onClick={() => commitSize(String(Math.max(1, s.sizePt - (s.sizePt > 12 ? 2 : 1))))}>
          A<span className="text-[10px]">−</span>
        </Btn>
        <Btn label="Larger text" onClick={() => commitSize(String(Math.min(400, s.sizePt + (s.sizePt >= 12 ? 2 : 1))))}>
          A<span className="text-[10px]">+</span>
        </Btn>
        <Sep />
        <Btn label="Bold (Ctrl+B)" active={s.bold} onClick={() => run().toggleBold().run()}>
          <b>B</b>
        </Btn>
        <Btn label="Italic (Ctrl+I)" active={s.italic} onClick={() => run().toggleItalic().run()}>
          <i className="font-serif">I</i>
        </Btn>
        <Btn label="Underline (Ctrl+U)" active={s.underline} onClick={() => run().toggleUnderline().run()}>
          <u>U</u>
        </Btn>
        <Btn label="Strikethrough" active={s.strike} onClick={() => run().toggleStrike().run()}>
          <s>S</s>
        </Btn>
        <Btn label="Superscript" active={s.sup} onClick={() => run().toggleSuperscript().run()}>
          x<sup className="text-[10px]">2</sup>
        </Btn>
        <Btn label="Subscript" active={s.sub} onClick={() => run().toggleSubscript().run()}>
          x<sub className="text-[10px]">2</sub>
        </Btn>
        <span className="relative">
          <button
            type="button"
            className="wc-tbtn flex-col !gap-0"
            title="Text colour"
            aria-label="Text colour"
            aria-haspopup="dialog"
            aria-expanded={popover === "color"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => toggle("color", e.currentTarget)}
          >
            <span className="font-semibold leading-none">A</span>
            <span className="mt-0.5 block h-1 w-5 rounded-sm border border-black/20" style={{ backgroundColor: s.color }} />
          </button>
          {popover === "color" && anchor && (
            <Popover anchor={anchor!} onClose={close} label="Text colour">
              <Swatches colors={COLORS} label="Text colour" onPick={(c) => run().setColor(c).run()} />
              <div className="mt-3 flex items-center gap-2">
                <label className="text-sm" htmlFor="wc-color-custom">
                  Custom
                </label>
                <input id="wc-color-custom" type="color" className="h-9 w-14 cursor-pointer rounded border" value={/^#[0-9a-f]{6}$/i.test(s.color) ? s.color : "#000000"} onChange={(e) => run().setColor(e.target.value).run()} />
                <button type="button" className="btn btn-secondary ml-auto min-h-9 px-3" onMouseDown={(e) => e.preventDefault()} onClick={() => run().unsetColor().run()}>
                  Automatic
                </button>
              </div>
            </Popover>
          )}
        </span>
        <span className="relative">
          <button
            type="button"
            className="wc-tbtn flex-col !gap-0"
            title="Highlight colour"
            aria-label="Highlight colour"
            aria-haspopup="dialog"
            aria-expanded={popover === "highlight"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => toggle("highlight", e.currentTarget)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m9 11-6 6v3h9l3-3" />
              <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
            </svg>
            <span className="mt-0.5 block h-1 w-5 rounded-sm border border-black/20" style={{ backgroundColor: s.highlight ?? "transparent" }} />
          </button>
          {popover === "highlight" && anchor && (
            <Popover anchor={anchor!} onClose={close} label="Highlight colour">
              <Swatches colors={HIGHLIGHTS} label="Highlight" onPick={(c) => run().setHighlight({ color: c }).run()} />
              <div className="mt-3 flex items-center gap-2">
                <label className="text-sm" htmlFor="wc-hl-custom">
                  Custom
                </label>
                <input id="wc-hl-custom" type="color" className="h-9 w-14 cursor-pointer rounded border" defaultValue="#ffff00" onChange={(e) => run().setHighlight({ color: e.target.value }).run()} />
                <button type="button" className="btn btn-secondary ml-auto min-h-9 px-3" onMouseDown={(e) => e.preventDefault()} onClick={() => run().unsetHighlight().run()}>
                  No colour
                </button>
              </div>
            </Popover>
          )}
        </span>
        <Btn label="Clear text formatting" onClick={() => run().unsetAllMarks().run()}>
          <Svg>
            <path d="M5 5h14M12 5v6M8 19h8M10 11l-3 8" />
            <path d="m16 14 5 5m0-5-5 5" />
          </Svg>
        </Btn>
        <Sep />
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
        <select
          className="wc-select"
          aria-label="Line spacing"
          data-assistant-id="wc-line-spacing"
          title="Line spacing"
          value={String(s.lineHeight)}
          onChange={(e) => run().setLineHeight(Number(e.target.value)).run()}
        >
          {LINE_SPACINGS.map((n) => (
            <option key={n} value={n}>
              {n === 1.15 ? "1.15 spacing" : `${n} spacing`}
            </option>
          ))}
        </select>
        <span className="relative">
          <button
            type="button"
            className="wc-tbtn"
            title="Space before and after paragraph"
            aria-label="Paragraph spacing"
            aria-haspopup="dialog"
            aria-expanded={popover === "spacing"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => toggle("spacing", e.currentTarget)}
          >
            <Svg>
              <path d="M7 4v16M3 8l4-4 4 4M3 16l4 4 4-4M15 6h6M15 12h6M15 18h6" />
            </Svg>
          </button>
          {popover === "spacing" && anchor && (
            <Popover anchor={anchor!} onClose={close} label="Paragraph spacing">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <label className="grid gap-1">
                  Before (pt)
                  <input className="field" type="number" min={0} max={200} step={1} value={s.before} onChange={(e) => setCell("before", e.target.value)} />
                </label>
                <label className="grid gap-1">
                  After (pt)
                  <input className="field" type="number" min={0} max={200} step={1} value={s.after} onChange={(e) => setCell("after", e.target.value)} />
                </label>
              </div>
            </Popover>
          )}
        </span>
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
        <Sep />
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
        <Sep />
        <Btn label="Insert image" data-assistant-id="wc-insert-image" disabled={busyImage} onClick={onPickImage}>
          <Svg>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="9" cy="10" r="1.5" />
            <path d="m21 16-5-5-9 9" />
          </Svg>
        </Btn>
        <span className="relative">
          <button
            type="button"
            className="wc-tbtn"
            title="Link"
            aria-label="Link"
            aria-pressed={s.link}
            aria-haspopup="dialog"
            aria-expanded={popover === "link"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => openLink(e.currentTarget)}
          >
            <Svg>
              <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
              <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
            </Svg>
          </button>
          {popover === "link" && anchor && (
            <Popover anchor={anchor!} onClose={close} label="Insert link">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  applyLink();
                }}
                className="grid gap-2 text-sm"
              >
                <label className="grid gap-1">
                  Web address
                  <input className="field" autoFocus type="text" inputMode="url" placeholder="example.com" value={linkText} onChange={(e) => setLinkText(e.target.value)} aria-invalid={!!linkError} aria-describedby={linkError ? "wc-link-error" : undefined} />
                </label>
                {linkError && (
                  <p id="wc-link-error" role="alert" className="text-xs" style={{ color: "var(--error-text)" }}>
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
            </Popover>
          )}
        </span>
        <Btn label="Add signature" data-assistant-id="wc-signature" onClick={onAddSignature}>
          <Svg>
            <path d="M3 17c2-5 4-9 6-9s1 6 3 6 2-4 4-4 2 3 5 3" />
            <path d="M3 21h18" />
          </Svg>
        </Btn>
        <Btn label="Horizontal line" onClick={() => run().setHorizontalRule().run()}>
          <Svg>
            <path d="M4 12h16" />
          </Svg>
        </Btn>
      </div>

      {s.image && s.imageAttrs && (
        <div className="flex flex-wrap items-center gap-2 border-t p-2 text-sm" style={{ borderColor: "var(--border)" }} role="group" aria-label="Picture options">
          <span className="font-medium">Picture</span>
          {[25, 50, 75, 100].map((pct) => (
            <button key={pct} type="button" className="btn btn-secondary min-h-10 px-3" onMouseDown={(e) => e.preventDefault()} onClick={() => run().updatePicture({ width: Math.round((CONTENT_WIDTH_PX * pct) / 100) }).run()}>
              {pct}% width
            </button>
          ))}
          <label className="flex items-center gap-2">
            <span>Description</span>
            <input
              className="field min-h-10 w-56"
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
      )}
    </div>
  );
}
