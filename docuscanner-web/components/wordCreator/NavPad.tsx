"use client";

// On-screen navigation keys for phones, which have no arrow keys. They move the caret the way the arrow keys do (using the
// browser's own caret movement, so lines, wrapped text and pictures behave as expected) and never take focus from the page or
// type anything. A physical keyboard keeps working exactly as before: nothing here listens for keys.

import type { Editor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import type { ReactNode } from "react";

type Move = "left" | "right" | "up" | "down" | "lineStart" | "lineEnd" | "pageUp" | "pageDown" | "docStart" | "docEnd";

function viewportBox() {
  const vv = window.visualViewport;
  return { top: vv?.offsetTop ?? 0, height: vv?.height ?? window.innerHeight };
}

export function moveCaret(editor: Editor, move: Move) {
  const view = editor.view;
  // Focus the page first (now, not on the next frame), so the browser moves the caret that is really in the document.
  if (!view.hasFocus()) view.focus();
  if (move === "docStart" || move === "docEnd") {
    const pos = move === "docStart" ? 0 : view.state.doc.content.size;
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos), move === "docStart" ? 1 : -1)).scrollIntoView());
    return;
  }
  if (move === "pageUp" || move === "pageDown") {
    // One screenful: scroll, then put the caret at the same horizontal place in the new view.
    const box = viewportBox();
    const dir = move === "pageDown" ? 1 : -1;
    const caret = view.coordsAtPos(view.state.selection.head);
    const dy = box.height * 0.8 * dir;
    window.scrollBy({ top: dy, behavior: "auto" });
    const y = Math.min(box.top + box.height - 120, Math.max(box.top + 80, caret.top + dy));
    const hit = view.posAtCoords({ left: caret.left, top: y });
    if (hit) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(hit.pos))));
    return;
  }
  // The caret is moved through the editor's own positions (not the browser's selection API, which some phone browsers
  // reset before the editor has noticed it), so every key does exactly one predictable step.
  const state = view.state;
  const head = state.selection.head;
  const put = (pos: number, bias: 1 | -1) => view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(Math.max(0, Math.min(state.doc.content.size, pos))), bias)).scrollIntoView());
  if (move === "left") return put(head - 1, -1);
  if (move === "right") return put(head + 1, 1);
  const c = view.coordsAtPos(head);
  const lineH = Math.max(12, c.bottom - c.top);
  const midY = (c.top + c.bottom) / 2;
  // The line's own block (paragraph, heading ...): its left and right edges are where this line starts and ends.
  const at = view.domAtPos(head).node;
  const block = ((at.nodeType === 3 ? at.parentElement : (at as HTMLElement)) as HTMLElement | null)?.closest("p, h1, h2, h3, li") ?? view.dom;
  const box = block.getBoundingClientRect();
  const target = move === "up" ? { left: c.left, top: c.top - lineH * 0.6 } : move === "down" ? { left: c.left, top: c.bottom + lineH * 0.6 } : move === "lineStart" ? { left: box.left + 1, top: midY } : { left: box.right - 1, top: midY };
  const hit = view.posAtCoords(target);
  if (hit) put(hit.pos, move === "up" || move === "lineStart" ? -1 : 1);
}

const KEYS: { move: Move; label: string; icon: ReactNode }[] = [
  { move: "left", label: "Move left", icon: "←" },
  { move: "right", label: "Move right", icon: "→" },
  { move: "up", label: "Move up one line", icon: "↑" },
  { move: "down", label: "Move down one line", icon: "↓" },
  { move: "lineStart", label: "Start of line", icon: "Home" },
  { move: "lineEnd", label: "End of line", icon: "End" },
  { move: "pageUp", label: "Page up", icon: "PgUp" },
  { move: "pageDown", label: "Page down", icon: "PgDn" },
  { move: "docStart", label: "Start of document", icon: "Top" },
  { move: "docEnd", label: "End of document", icon: "Bottom" },
];

export function NavPad({ editor }: { editor: Editor }) {
  return (
    <div className="wc-navpad" role="group" aria-label="Move through the document" data-testid="wc-navpad">
      {KEYS.map((k) => (
        <button
          key={k.move}
          type="button"
          className="wc-tbtn"
          title={k.label}
          aria-label={k.label}
          // Neither the press nor the tap may move focus out of the page (that would close the on-screen keyboard).
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={(e) => e.pointerType !== "mouse" && e.preventDefault()}
          onClick={() => moveCaret(editor, k.move)}
        >
          {k.icon}
        </button>
      ))}
    </div>
  );
}
