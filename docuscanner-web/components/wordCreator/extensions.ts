// The editor's building blocks beyond what Tiptap ships: paragraph spacing / indent / Title styles,
// the picture node (resizable, aligned), and the page layout that lays text out on A4 sheets.
import { Extension, Node, mergeAttributes } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { layoutPages, type Spacer } from "@/utils/wordCreator/layout";
import { CONTENT_WIDTH_PX, MAX_INDENT } from "@/utils/wordCreator/model";

const TEXT_BLOCKS = ["paragraph", "heading"];
const numAttr = (name: string) => (el: HTMLElement) => {
  const v = Number(el.getAttribute(name));
  return Number.isFinite(v) && el.hasAttribute(name) ? v : null;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    paragraphFormat: {
      setLineHeight: (value: number | null) => ReturnType;
      setParagraphSpacing: (spacing: { before?: number | null; after?: number | null }) => ReturnType;
      changeIndent: (delta: number) => ReturnType;
      setBlockStyle: (style: "normal" | "title" | "subtitle" | "h1" | "h2" | "h3") => ReturnType;
    };
    wordImage: {
      insertPicture: (attrs: { src: string; width?: number; alt?: string }) => ReturnType;
      updatePicture: (attrs: { width?: number; align?: "left" | "center" | "right"; alt?: string }) => ReturnType;
    };
  }
}

// ---- paragraph formatting ---------------------------------------------------------------------------------------------
export const ParagraphFormat = Extension.create({
  name: "paragraphFormat",

  addGlobalAttributes() {
    return [
      {
        types: TEXT_BLOCKS,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: numAttr("data-line-height"),
            renderHTML: (a) => (a.lineHeight ? { "data-line-height": a.lineHeight, style: `--wc-lh:${a.lineHeight}` } : {}),
          },
          spaceBefore: {
            default: null,
            parseHTML: numAttr("data-space-before"),
            renderHTML: (a) => (a.spaceBefore !== null && a.spaceBefore !== undefined ? { "data-space-before": a.spaceBefore, style: `--wc-before:${a.spaceBefore}` } : {}),
          },
          spaceAfter: {
            default: null,
            parseHTML: numAttr("data-space-after"),
            renderHTML: (a) => (a.spaceAfter !== null && a.spaceAfter !== undefined ? { "data-space-after": a.spaceAfter, style: `--wc-after:${a.spaceAfter}` } : {}),
          },
          indent: {
            default: 0,
            parseHTML: (el: HTMLElement) => Math.min(MAX_INDENT, Math.max(0, Number(el.getAttribute("data-indent")) || 0)),
            renderHTML: (a) => (a.indent ? { "data-indent": a.indent, style: `--wc-indent:${a.indent}` } : {}),
          },
        },
      },
      {
        types: ["paragraph"],
        attributes: {
          variant: {
            default: null,
            parseHTML: (el: HTMLElement) => {
              const v = el.getAttribute("data-variant");
              return v === "title" || v === "subtitle" ? v : null;
            },
            renderHTML: (a) => (a.variant ? { "data-variant": a.variant } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    const setAttrs =
      (make: (node: PMNode) => Record<string, unknown>) =>
      () =>
      ({ tr, state, dispatch }: { tr: import("@tiptap/pm/state").Transaction; state: import("@tiptap/pm/state").EditorState; dispatch?: (tr: import("@tiptap/pm/state").Transaction) => void }) => {
        const { from, to } = state.selection;
        let changed = false;
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!TEXT_BLOCKS.includes(node.type.name)) return;
          const next = make(node);
          if (Object.entries(next).some(([k, v]) => node.attrs[k] !== v)) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...next });
            changed = true;
          }
        });
        if (changed && dispatch) dispatch(tr);
        return true;
      };

    return {
      setLineHeight: (value) => setAttrs(() => ({ lineHeight: value }))(),
      setParagraphSpacing: (spacing) =>
        setAttrs(() => ({
          ...(spacing.before !== undefined ? { spaceBefore: spacing.before } : {}),
          ...(spacing.after !== undefined ? { spaceAfter: spacing.after } : {}),
        }))(),
      changeIndent: (delta) => setAttrs((node) => ({ indent: Math.min(MAX_INDENT, Math.max(0, (node.attrs.indent ?? 0) + delta)) }))(),
      setBlockStyle:
        (style) =>
        ({ tr, state, dispatch }) => {
          const { schema } = state;
          const { from, to } = state.selection;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!TEXT_BLOCKS.includes(node.type.name)) return;
            const level = style === "h1" ? 1 : style === "h2" ? 2 : style === "h3" ? 3 : 0;
            const type = level ? schema.nodes.heading : schema.nodes.paragraph;
            const attrs: Record<string, unknown> = { ...node.attrs };
            if (level) attrs.level = level;
            attrs.variant = style === "title" || style === "subtitle" ? style : null;
            // Keep only the attributes the new block type has.
            const allowed = type.create().attrs;
            for (const k of Object.keys(attrs)) if (!(k in allowed)) delete attrs[k];
            tr.setNodeMarkup(pos, type, attrs);
          });
          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});

// ---- pictures ---------------------------------------------------------------------------------------------------------------
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif);base64,/;

export const WordImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: "" },
      width: { default: null },
      align: { default: "left" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "img[src]",
        getAttrs: (el) => {
          const src = (el as HTMLElement).getAttribute("src") ?? "";
          if (!DATA_IMAGE.test(src)) return false; // never pull in a picture from a web address
          const w = Number((el as HTMLElement).getAttribute("width"));
          return {
            src,
            alt: (el as HTMLElement).getAttribute("alt") ?? "",
            width: w > 0 ? w : null,
            align: (el as HTMLElement).getAttribute("data-align") ?? "left",
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["img", mergeAttributes({ src: node.attrs.src, alt: node.attrs.alt, "data-align": node.attrs.align, ...(node.attrs.width ? { width: node.attrs.width } : {}) }, HTMLAttributes.class ? { class: HTMLAttributes.class } : {})];
  },

  addCommands() {
    return {
      insertPicture:
        (attrs) =>
        ({ commands, state }) => {
          const content = { type: "image", attrs: { align: "left", ...attrs } };
          // A selected picture is not replaced: the new one goes after it.
          return "node" in state.selection ? commands.insertContentAt(state.selection.to, content) : commands.insertContent(content);
        },
      updatePicture:
        (attrs) =>
        ({ commands }) =>
          commands.updateAttributes("image", attrs),
    };
  },

  addNodeView() {
    return ({ node: initial, getPos, editor }) => {
      let node = initial;
      const dom = document.createElement("div");
      dom.className = "wc-img";
      const img = document.createElement("img");
      img.draggable = false;
      const handle = document.createElement("span");
      handle.className = "wc-img-handle";
      handle.setAttribute("aria-hidden", "true");
      dom.append(img, handle);

      const apply = () => {
        img.src = node.attrs.src;
        img.alt = node.attrs.alt ?? "";
        dom.dataset.align = node.attrs.align ?? "left";
        const w = node.attrs.width;
        img.style.width = w ? `${Math.min(w, CONTENT_WIDTH_PX)}px` : "";
      };
      apply();
      // Before the picture has loaded, show it no wider than the page.
      img.addEventListener("load", () => {
        if (!node.attrs.width) img.style.width = `${Math.min(img.naturalWidth, CONTENT_WIDTH_PX)}px`;
      });

      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const scale = dom.getBoundingClientRect().width / (dom.offsetWidth || 1) || 1;
        const startX = event.clientX;
        const startW = img.getBoundingClientRect().width / scale;
        handle.setPointerCapture(event.pointerId);
        let width = startW;
        const move = (e: PointerEvent) => {
          width = Math.round(Math.max(24, Math.min(CONTENT_WIDTH_PX, startW + (e.clientX - startX) / scale)));
          img.style.width = `${width}px`;
        };
        const up = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", up);
          handle.removeEventListener("pointercancel", up);
          const pos = getPos();
          if (typeof pos === "number") editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, width }));
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
      });

      return {
        dom,
        update: (next) => {
          if (next.type !== node.type) return false;
          node = next;
          apply();
          return true;
        },
        stopEvent: (event) => event.target === handle,
        ignoreMutation: () => true,
      };
    };
  },
});

// ---- pages ------------------------------------------------------------------------------------------------------------------------
// The text runs down one long column; this puts it on A4 sheets. A grey strip is painted between
// sheets by CSS, and here a block that would straddle the end of a sheet is moved whole onto the
// next one by an invisible spacer. A block taller than a sheet (a huge picture) is left to cross.
// Spacers exist only on screen: the .docx is laid out by Word itself.
const paginationKey = new PluginKey<{ spacers: Spacer[] }>("wcPagination");

export const Pagination = Extension.create<{ onPages?: (pages: number) => void }>({
  name: "pagination",

  addOptions() {
    return { onPages: undefined };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key: paginationKey,
        state: {
          init: () => ({ spacers: [] as Spacer[] }),
          apply: (tr, value) => tr.getMeta(paginationKey) ?? value,
        },
        props: {
          decorations(state) {
            const { spacers } = paginationKey.getState(state)!;
            if (!spacers.length) return DecorationSet.empty;
            const heights = new Map(spacers.map((s) => [s.index, s.height]));
            const decorations: Decoration[] = [];
            state.doc.forEach((_node, offset, index) => {
              const height = heights.get(index);
              if (!height) return;
              decorations.push(
                Decoration.widget(
                  offset,
                  () => {
                    const el = document.createElement("div");
                    el.className = "wc-page-gap";
                    el.dataset.pageGap = String(height);
                    el.style.height = `${height}px`;
                    el.contentEditable = "false";
                    el.setAttribute("aria-hidden", "true");
                    return el;
                  },
                  { side: -1, key: `gap-${index}-${height}`, ignoreSelection: true },
                ),
              );
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
        view(view) {
          let frame = 0;
          let lastPages = 0;

          const measure = () => {
            frame = 0;
            const root = view.dom as HTMLElement;
            if (!root.isConnected || root.offsetParent === null) return;
            const paddingTop = parseFloat(getComputedStyle(root).paddingTop) || 0;
            const blocks: { top: number; bottom: number }[] = [];
            let above = 0;
            for (const child of Array.from(root.children) as HTMLElement[]) {
              if (child.classList.contains("ProseMirror-gapcursor")) continue;
              if (child.hasAttribute("data-page-gap")) {
                above += Number(child.dataset.pageGap) || 0;
                continue;
              }
              const cs = getComputedStyle(child);
              const mt = parseFloat(cs.marginTop) || 0;
              const mb = parseFloat(cs.marginBottom) || 0;
              const top = child.offsetTop - paddingTop - above;
              blocks.push({ top: top - mt, bottom: top + child.offsetHeight + mb });
            }
            if (blocks.length !== view.state.doc.childCount) return; // mid-update; the next frame will be right
            const { spacers, pages } = layoutPages(blocks);
            const current = paginationKey.getState(view.state)!.spacers;
            const same = spacers.length === current.length && spacers.every((s, i) => s.index === current[i].index && Math.abs(s.height - current[i].height) < 0.6);
            if (!same) view.dispatch(view.state.tr.setMeta(paginationKey, { spacers }).setMeta("addToHistory", false));
            if (pages !== lastPages) {
              lastPages = pages;
              options.onPages?.(pages);
            }
          };
          const schedule = () => {
            if (!frame) frame = requestAnimationFrame(measure);
          };
          const observer = new ResizeObserver(schedule);
          observer.observe(view.dom);
          schedule();
          return {
            update: schedule,
            destroy() {
              if (frame) cancelAnimationFrame(frame);
              observer.disconnect();
            },
          };
        },
      }),
    ];
  },
});
