"use client";

// Zoom for the editing surfaces (page editor, annotator, crop editor): buttons,
// pinch on touch, Ctrl+wheel / trackpad pinch on desktop, and + / - / 0 on the
// keyboard, with a one-tap way back to normal size.
//
// Zoom is done by resizing, not by CSS transform: ZoomFrame makes the page
// `normal width x zoom` inside a scrollable ZoomViewport. Every surface computes
// pointer positions from the frame's on-screen rectangle as a fraction, so marks,
// hit-testing, text size and crop corners stay correct at any zoom without any of
// that code knowing about it.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

// "Normal size" is 1: the page fitted to the screen, exactly as before zoom existed.
export const ZOOM_NORMAL = 1;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 4;
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export interface ZoomApi {
  zoom: number;
  // ZoomViewport attaches itself with the callback ref; effects read it back with getViewport.
  attachViewport: (el: HTMLDivElement | null) => void;
  getViewport: () => HTMLDivElement | null;
  // Stable functions, safe to use in effects.
  getZoom: () => number;
  // Multiplies the zoom, keeping the point under `anchor` (client coordinates)
  // still; `pan` moves the content by that many pixels as well (two-finger drag).
  zoomBy: (factor: number, anchor?: { x: number; y: number }, pan?: { dx: number; dy: number }) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
}

interface Pending {
  ratio: number;
  ax: number;
  ay: number;
  dx: number;
  dy: number;
  reset: boolean;
}

function clampZoom(value: number): number {
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
  // Land exactly on normal size when close, so a pinch can return to it.
  if (Math.abs(clamped - ZOOM_NORMAL) < 0.03) return ZOOM_NORMAL;
  return Math.round(clamped * 1000) / 1000;
}

export function useZoom(): ZoomApi {
  const [zoom, setZoomState] = useState(ZOOM_NORMAL);
  const zoomRef = useRef(ZOOM_NORMAL);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pending = useRef<Pending | null>(null);

  // After the new size has been laid out, put the scroll position where the anchor
  // point (or the centre) still is, so the page grows around what you were looking at.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    const p = pending.current;
    if (!el || !p) return;
    pending.current = null;
    if (p.reset) {
      el.scrollLeft = 0;
      el.scrollTop = 0;
      return;
    }
    el.scrollLeft = (el.scrollLeft + p.ax) * p.ratio - p.ax - p.dx;
    el.scrollTop = (el.scrollTop + p.ay) * p.ratio - p.ay - p.dy;
  }, [zoom]);

  const attachViewport = useCallback((el: HTMLDivElement | null) => {
    viewportRef.current = el;
  }, []);

  const getViewport = useCallback(() => viewportRef.current, []);
  const getZoom = useCallback(() => zoomRef.current, []);

  const zoomTo = useCallback((next: number, anchor?: { x: number; y: number }, pan?: { dx: number; dy: number }) => {
    const el = viewportRef.current;
    const previous = zoomRef.current;
    const target = clampZoom(next);
    if (target === previous) {
      // Same size: a two-finger drag still moves the page around.
      if (el && pan) {
        el.scrollLeft -= pan.dx;
        el.scrollTop -= pan.dy;
      }
      return;
    }
    if (el) {
      const rect = el.getBoundingClientRect();
      const before = pending.current;
      pending.current = {
        ratio: (before?.ratio ?? 1) * (target / previous),
        ax: anchor ? anchor.x - rect.left : el.clientWidth / 2,
        ay: anchor ? anchor.y - rect.top : el.clientHeight / 2,
        dx: (before?.dx ?? 0) + (pan?.dx ?? 0),
        dy: (before?.dy ?? 0) + (pan?.dy ?? 0),
        reset: false,
      };
    }
    zoomRef.current = target;
    setZoomState(target);
  }, []);

  const zoomBy = useCallback(
    (factor: number, anchor?: { x: number; y: number }, pan?: { dx: number; dy: number }) => zoomTo(zoomRef.current * factor, anchor, pan),
    [zoomTo],
  );

  const step = useCallback(
    (direction: 1 | -1) => {
      const current = zoomRef.current;
      const next = direction === 1 ? ZOOM_STEPS.find((s) => s > current + 0.001) : [...ZOOM_STEPS].reverse().find((s) => s < current - 0.001);
      if (next !== undefined) zoomTo(next);
    },
    [zoomTo],
  );

  const reset = useCallback(() => {
    const el = viewportRef.current;
    if (zoomRef.current === ZOOM_NORMAL) {
      if (el) {
        el.scrollLeft = 0;
        el.scrollTop = 0;
      }
      return;
    }
    pending.current = { ratio: 1, ax: 0, ay: 0, dx: 0, dy: 0, reset: true };
    zoomRef.current = ZOOM_NORMAL;
    setZoomState(ZOOM_NORMAL);
  }, []);

  return useMemo(
    () => ({ zoom, attachViewport, getViewport, getZoom, zoomBy, zoomIn: () => step(1), zoomOut: () => step(-1), reset }),
    [zoom, attachViewport, getViewport, getZoom, zoomBy, step, reset],
  );
}

// The page's own box, sized `fit x zoom`. `fit` is the CSS width the surface used
// before zoom existed (so zoom 1 is pixel-for-pixel the old layout).
export function ZoomFrame({ zoom, fit, minWidth, children }: { zoom: number; fit: string; minWidth?: string; children: ReactNode }) {
  return (
    <div className="mx-auto" style={{ width: `calc(${fit} * ${zoom})`, minWidth }}>
      {children}
    </div>
  );
}

function isTopmostDialog(el: HTMLElement): boolean {
  const own = el.closest('[role="dialog"]');
  if (!own) return true;
  const all = document.querySelectorAll('[role="dialog"]');
  return all[all.length - 1] === own;
}

// The scrollable window onto the page. Adds pinch (with two-finger panning),
// Ctrl+wheel and the +/-/0 keys. Put it around a ZoomFrame.
export function ZoomViewport({ api, className, children }: { api: ZoomApi; className?: string; children: ReactNode }) {
  const pointers = useRef(new Map<number, { x: number; y: number; target: EventTarget | null }>());
  const pinch = useRef<{ startDistance: number; startZoom: number; mid: { x: number; y: number } } | null>(null);
  // Once a pinch begins, the fingers belong to it until every one is lifted.
  const owned = useRef(false);
  const elementRef = useRef<HTMLDivElement>(null);
  // Two fingers report their moves as separate events, so reading the distance
  // after each one mixes a fresh position with a stale one and the zoom jitters.
  // The pinch is applied once per frame instead, when both are up to date.
  const frame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  // Tell the zoom state which element to keep scrolled where the zoom is anchored.
  useLayoutEffect(() => {
    api.attachViewport(elementRef.current);
    return () => api.attachViewport(null);
  }, [api]);

  // Ctrl+wheel (also how a trackpad pinch arrives). Needs a non-passive listener to
  // stop the browser zooming the whole page instead.
  useEffect(() => {
    const el = api.getViewport();
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      api.zoomBy(Math.exp(-delta * 0.0025), { x: e.clientX, y: e.clientY });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [api]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if (target instanceof HTMLElement && target.isContentEditable) return;
      const el = api.getViewport();
      // Only the editor on top answers (the page editor stays open beneath the others).
      if (!el || !isTopmostDialog(el)) return;
      if (e.key === "+" || e.key === "=") api.zoomIn();
      else if (e.key === "-" || e.key === "_") api.zoomOut();
      else if (e.key === "0") api.reset();
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [api]);

  function distanceAndMid(): { distance: number; mid: { x: number; y: number } } {
    const [a, b] = [...pointers.current.values()];
    return { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  }

  function endPointer(e: React.PointerEvent) {
    // Our own pointercancel (sent to abort a drawing) is not a finger lifting.
    if (e.pointerType !== "touch" || !e.isTrusted) return;
    pointers.current.delete(e.pointerId);
    if (!owned.current) return;
    e.stopPropagation();
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) owned.current = false;
  }

  return (
    <div
      ref={elementRef}
      className={className}
      // One finger scrolls as usual; the browser must not take two-finger pinch
      // for itself, or this handler never sees it.
      style={{ touchAction: "pan-x pan-y" }}
      onPointerDownCapture={(e) => {
        if (e.pointerType !== "touch") return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, target: e.target });
        if (pointers.current.size === 2) {
          const { distance, mid } = distanceAndMid();
          pinch.current = { startDistance: distance, startZoom: api.getZoom(), mid };
          owned.current = true;
          // The first finger may have started drawing or dragging something: cancel
          // that, so a pinch never leaves a stray mark.
          for (const [id, p] of pointers.current) {
            if (id === e.pointerId) continue;
            p.target?.dispatchEvent(new PointerEvent("pointercancel", { pointerId: id, pointerType: "touch", bubbles: true, cancelable: true }));
          }
          e.stopPropagation();
        } else if (owned.current) {
          e.stopPropagation();
        }
      }}
      onPointerMoveCapture={(e) => {
        if (e.pointerType !== "touch") return;
        const p = pointers.current.get(e.pointerId);
        if (!p) return;
        p.x = e.clientX;
        p.y = e.clientY;
        if (!owned.current) return;
        e.stopPropagation();
        if (frame.current !== null) return;
        frame.current = requestAnimationFrame(() => {
          frame.current = null;
          const state = pinch.current;
          if (!state || pointers.current.size < 2) return;
          const { distance, mid } = distanceAndMid();
          api.zoomBy((state.startZoom * (distance / state.startDistance)) / api.getZoom(), mid, { dx: mid.x - state.mid.x, dy: mid.y - state.mid.y });
          state.mid = mid;
        });
      }}
      onPointerUpCapture={(e) => endPointer(e)}
      onPointerCancelCapture={(e) => endPointer(e)}
    >
      {children}
    </div>
  );
}

// - / percentage / + . The middle button says Reset while zoomed and takes the
// page back to normal size (and to the top-left).
export function ZoomControls({ api, className = "" }: { api: ZoomApi; className?: string }) {
  const percent = Math.round(api.zoom * 100);
  const zoomed = api.zoom !== ZOOM_NORMAL;
  const button = "flex h-11 items-center justify-center rounded-lg border border-zinc-300 bg-surface text-sm font-medium disabled:opacity-40 dark:border-zinc-700";
  return (
    <div role="group" aria-label="Zoom" className={`flex items-center gap-1 ${className}`}>
      <button type="button" aria-label="Zoom out" title="Zoom out (−)" disabled={api.zoom <= ZOOM_MIN} onClick={api.zoomOut} className={`${button} w-11 text-lg`}>
        −
      </button>
      <button
        type="button"
        aria-label={zoomed ? `Reset zoom to normal size (now ${percent}%)` : "Normal size (100%)"}
        title="Back to normal size (0)"
        disabled={!zoomed}
        onClick={api.reset}
        className={`${button} min-w-[4.5rem] px-2 tabular-nums`}
      >
        {zoomed ? `${percent}% · Reset` : "100%"}
      </button>
      <button type="button" aria-label="Zoom in" title="Zoom in (+)" disabled={api.zoom >= ZOOM_MAX} onClick={api.zoomIn} className={`${button} w-11 text-lg`}>
        +
      </button>
    </div>
  );
}
