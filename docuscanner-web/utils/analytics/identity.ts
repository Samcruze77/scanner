"use client";

// Anonymous visitor/session identity, kept entirely client-side. No PII, no
// signup required -- this is what lets track-analytics attribute guest
// activity (scan/convert/download) without an account.
//
// visitor_id: stable per-browser, persisted in localStorage.
// session_id: rotates after SESSION_IDLE_MS of inactivity, persisted in
// sessionStorage plus a "last seen" timestamp in localStorage so a new tab
// still counts as the same session within the idle window.

import { hasConsent } from "@/utils/consent/consent";

const VISITOR_ID_KEY = "ds_visitor_id";
const SESSION_ID_KEY = "ds_session_id";
const SESSION_LAST_SEEN_KEY = "ds_session_last_seen";
export const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 minutes of no user activity ends a session

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

// Every identifier below is created and read ONLY with "analytics" consent;
// without it there is no visitor or session ID at all (and therefore nothing
// for the tracking calls to send).
export function getVisitorId(): string | null {
  if (typeof window === "undefined" || !hasConsent("analytics")) return null;

  let id = safeGet(window.localStorage, VISITOR_ID_KEY);
  if (!id) {
    id = newId();
    safeSet(window.localStorage, VISITOR_ID_KEY, id);
  }
  return id;
}

export function getSessionId(): string | null {
  if (typeof window === "undefined" || !hasConsent("analytics")) return null;

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

// Reads the current session id WITHOUT refreshing its idle timer, and returns null when the
// session has already been idle longer than SESSION_IDLE_MS. The presence heartbeat uses
// this: a background heartbeat is not user activity, so it must neither keep a session
// alive forever nor revive an expired one (that is how one visible-but-idle tab used to
// stay a single session indefinitely).
export function peekSessionId(now = Date.now()): string | null {
  if (typeof window === "undefined" || !hasConsent("analytics")) return null;
  const lastSeen = Number(safeGet(window.localStorage, SESSION_LAST_SEEN_KEY) ?? 0);
  const id = safeGet(window.sessionStorage, SESSION_ID_KEY);
  if (!id || !lastSeen || now - lastSeen > SESSION_IDLE_MS) return null;
  return id;
}

const ACTIVITY_THROTTLE_MS = 5_000;
let lastActivityMark = 0;

// Real user activity (pointer, key, touch, scroll): refreshes the idle timer, and starts a
// new session if the previous one had expired. Throttled so scrolling is cheap.
export function markActivity(now = Date.now()): void {
  if (typeof window === "undefined" || !hasConsent("analytics")) return;
  if (now - lastActivityMark < ACTIVITY_THROTTLE_MS) return;
  lastActivityMark = now;
  getSessionId();
}

export function resetActivityThrottleForTests(): void {
  lastActivityMark = 0;
}

export function isNewSessionThisPageLoad(): boolean {
  if (typeof window === "undefined" || !hasConsent("analytics")) return false;
  // sessionStorage is per-tab and empty on first load of a tab/session, so
  // absence here (before getSessionId() creates one) means app_open.
  return !safeGet(window.sessionStorage, SESSION_ID_KEY);
}
