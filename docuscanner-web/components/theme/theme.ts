// The person's appearance choice: Light, Soft Gray or Dark.
//
//  - The choice lives in the `data-theme` attribute on <html>; app/globals.css turns it
//    into colours. Nothing else in the page needs to know which theme is active.
//  - It is remembered in this browser's localStorage. No account is needed and it is
//    never sent anywhere (no analytics event, no device information).
//  - With no saved choice the theme follows the system's light/dark setting (Light or
//    Dark; Soft Gray is only ever an explicit choice), and keeps following it if the
//    system setting changes.
//  - THEME_INIT_SCRIPT runs in <head> before the first paint, so a saved theme is on
//    screen from the very first frame instead of flashing the default first.

import type { IconName } from "@/components/ui/icons";

export type ThemeId = "light" | "soft" | "dark";

export const THEMES: { id: ThemeId; label: string; icon: IconName }[] = [
  { id: "light", label: "Light", icon: "sun" },
  { id: "soft", label: "Soft Gray", icon: "contrast" },
  { id: "dark", label: "Dark", icon: "moon" },
];

export const THEME_STORAGE_KEY = "pdfscanner.theme";
export const THEME_CHANGE_EVENT = "pdfscanner:theme-change";

export function isThemeId(value: unknown): value is ThemeId {
  return value === "light" || value === "soft" || value === "dark";
}

// Kept in step with applyTheme() below; it has to be self-contained because it runs
// before any of the app's code has loaded.
export const THEME_INIT_SCRIPT = `(function(){var t=null;try{t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}if(t!=="light"&&t!=="soft"&&t!=="dark"){try{t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch(e){t="light"}}document.documentElement.setAttribute("data-theme",t)})()`;

export function readStoredTheme(): ThemeId | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemeId(value) ? value : null;
  } catch {
    // Storage blocked (private mode): the choice just lasts until the tab closes.
    return null;
  }
}

export function systemTheme(): ThemeId {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

// The theme on screen right now.
export function currentTheme(): ThemeId {
  const value = document.documentElement.getAttribute("data-theme");
  return isThemeId(value) ? value : (readStoredTheme() ?? systemTheme());
}

let switchTimer: number | undefined;

// Puts a theme on screen immediately, with a very brief colour fade.
export function applyTheme(theme: ThemeId): void {
  const root = document.documentElement;
  if (root.getAttribute("data-theme") === theme) return;
  root.classList.add("theme-switching");
  root.setAttribute("data-theme", theme);
  window.clearTimeout(switchTimer);
  switchTimer = window.setTimeout(() => root.classList.remove("theme-switching"), 250);
}

// The person picked a theme: show it and remember it.
export function chooseTheme(theme: ThemeId): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Not stored: it still applies for this visit.
  }
  applyTheme(theme);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

// For useSyncExternalStore: re-read the theme when it changes here, in another tab, or
// (when nothing has been chosen) when the system's light/dark setting changes.
export function subscribeToTheme(callback: () => void): () => void {
  const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  const onSystemChange = () => {
    if (readStoredTheme() === null) {
      applyTheme(systemTheme());
      callback();
    }
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === THEME_STORAGE_KEY) {
      applyTheme(readStoredTheme() ?? systemTheme());
      callback();
    }
  };

  window.addEventListener(THEME_CHANGE_EVENT, callback);
  window.addEventListener("storage", onStorage);
  media?.addEventListener("change", onSystemChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, callback);
    window.removeEventListener("storage", onStorage);
    media?.removeEventListener("change", onSystemChange);
  };
}
