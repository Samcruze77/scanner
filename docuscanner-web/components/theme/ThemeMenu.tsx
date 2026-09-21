"use client";

// The theme selector: one 44px button in the header showing the current theme's icon
// (sun, half-circle or moon). It opens a small menu with the three choices. The same
// control is used at every screen size, so it never crowds the header or the bottom
// navigation, and it stays out of the scanner workspace.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/icons";
import { chooseTheme, currentTheme, subscribeToTheme, THEMES, type ThemeId } from "./theme";

// The server can't know the saved theme; the browser corrects it right after load.
const serverTheme = (): ThemeId => "light";

export function ThemeMenu() {
  const theme = useSyncExternalStore(subscribeToTheme, currentTheme, serverTheme);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const active = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  useEffect(() => {
    if (!open) return;
    activeRef.current?.focus();
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function pick(id: ThemeId) {
    chooseTheme(id);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Theme: ${active.label}`}
        aria-haspopup="true"
        aria-expanded={open}
        title="Change theme"
        className="btn btn-icon btn-ghost"
      >
        <Icon name={active.icon} size={20} />
      </button>

      {open && (
        <div
          role="group"
          aria-label="Theme"
          className="absolute right-0 top-full z-50 mt-2 w-52 rounded-xl border border-line bg-elevated p-1 shadow-xl"
        >
          {THEMES.map((t) => {
            const selected = t.id === theme;
            return (
              <button
                key={t.id}
                ref={selected ? activeRef : undefined}
                type="button"
                aria-pressed={selected}
                onClick={() => pick(t.id)}
                className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm ${
                  selected ? "bg-selected font-semibold" : "hover:bg-hover"
                }`}
              >
                <Icon name={t.icon} size={18} />
                <span className="flex-1 text-left">{t.label}</span>
                {selected && <Icon name="check" size={18} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
