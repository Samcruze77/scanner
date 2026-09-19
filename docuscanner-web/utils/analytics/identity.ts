"use client";

// Anonymous visitor/session identity, kept entirely client-side. No PII, no
// signup required -- this is what lets track-analytics attribute guest
// activity (scan/convert/download) without an account.
//
// visitor_id: stable per-browser, persisted in localStorage.
// session_id: rotates after SESSION_IDLE_MS of inactivity, persisted in
// sessionStorage plus a "last seen" timestamp in localStorage so a new tab
// still counts as the same session within the idle window.

const VISITOR_ID_KEY = "ds_visitor_id";
const SESSION_ID_KEY = "ds_session_id";
const SESSION_LAST_SEEN_KEY = "ds_session_last_seen";
const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 minutes

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function safeGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode, quota, etc) -- analytics just
    // won't persist an id across reloads. Never throw from here.
  }
}

export function getVisitorId(): string | null {
  if (typeof window === "undefined") return null;

  let id = safeGet(window.localStorage, VISITOR_ID_KEY);
  if (!id) {
    id = newId();
    safeSet(window.localStorage, VISITOR_ID_KEY, id);
  }
  return id;
}

export function getSessionId(): string | null {
  if (typeof window === "undefined") return null;

  const now = Date.now();
  const lastSeen = Number(safeGet(window.localStorage, SESSION_LAST_SEEN_KEY) ?? 0);
  let id = safeGet(window.sessionStorage, SESSION_ID_KEY);

  const expired = !lastSeen || now - lastSeen > SESSION_IDLE_MS;
  if (!id || expired) {
    id = newId();
    safeSet(window.sessionStorage, SESSION_ID_KEY, id);
  }

  safeSet(window.localStorage, SESSION_LAST_SEEN_KEY, String(now));
  return id;
}

export function isNewSessionThisPageLoad(): boolean {
  if (typeof window === "undefined") return false;
  // sessionStorage is per-tab and empty on first load of a tab/session, so
  // absence here (before getSessionId() creates one) means app_open.
  return !safeGet(window.sessionStorage, SESSION_ID_KEY);
}
