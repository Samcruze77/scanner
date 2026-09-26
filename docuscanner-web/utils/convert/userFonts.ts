"use client";

// Font files for Word -> PDF that the browser can supply beyond the bundled
// look-alikes: files the person adds, fonts installed on their device, and fonts
// the site owner hosts. Nothing here leaves the device.
//
// Fonts such as Aptos can't ship with the site (they are licensed, not open), so
// these are the ways to lay a document out with the real font's widths.

export type FontFile = { bytes: Uint8Array };

// ---- files the person added (kept in this browser) -------------------------------------

const DB_NAME = "pdfscanner-fonts";
const STORE = "fonts";
// A generous cap: a family is a handful of ~0.5 MB files.
const MAX_FILES = 40;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let memory: FontFile[] = [];
let loaded = false;

export async function getUserFonts(): Promise<FontFile[]> {
  if (loaded) return memory;
  try {
    const db = await openDb();
    const all = await new Promise<Uint8Array[]>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result as Uint8Array[]);
      request.onerror = () => reject(request.error);
    });
    db.close();
    memory = [...memory, ...all.map((bytes) => ({ bytes }))];
  } catch {
    // Storage can be blocked (private windows); the session's own list still works.
  }
  loaded = true;
  return memory;
}

// Adds font files (.ttf/.otf/.woff). Returns how many were accepted.
export async function addUserFonts(files: File[]): Promise<number> {
  await getUserFonts();
  const added: Uint8Array[] = [];
  for (const file of files) {
    if (memory.length + added.length >= MAX_FILES || file.size > MAX_FILE_BYTES) continue;
    added.push(new Uint8Array(await file.arrayBuffer()));
  }
  memory = [...memory, ...added.map((bytes) => ({ bytes }))];
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      for (const bytes of added) tx.objectStore(STORE).add(bytes);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Kept for this session only.
  }
  return added.length;
}

export async function clearUserFonts(): Promise<void> {
  memory = [];
  loaded = true;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Nothing to clear.
  }
}

// ---- fonts installed on the device (Local Font Access API, Chromium) -------------------

interface LocalFontData {
  family: string;
  fullName: string;
  style: string;
  blob(): Promise<Blob>;
}
type WindowWithFonts = Window & { queryLocalFonts?: () => Promise<LocalFontData[]> };

export function installedFontsSupported(): boolean {
  return typeof window !== "undefined" && typeof (window as WindowWithFonts).queryLocalFonts === "function";
}

async function installedFontsPermission(): Promise<PermissionState | "unsupported"> {
  if (!installedFontsSupported()) return "unsupported";
  try {
    return (await navigator.permissions.query({ name: "local-fonts" as PermissionName })).state;
  } catch {
    return "prompt";
  }
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const MAX_INSTALLED_FILES = 24;

// Reads the installed font files for the given family names. Never asks for
// permission by itself: it only reads fonts once the person has allowed it.
export async function findInstalledFonts(names: string[]): Promise<FontFile[]> {
  if ((await installedFontsPermission()) !== "granted") return [];
  return readInstalled(names);
}

async function readInstalled(names: string[]): Promise<FontFile[]> {
  const wanted = names.map(norm);
  const all = await (window as WindowWithFonts).queryLocalFonts!();
  // `family` may be the base family ("Aptos") or the Word-style one ("Aptos
  // SemiBold"); the font itself is classified by its own name table afterwards.
  const hits = all.filter((f) => wanted.some((n) => norm(f.family) === n || norm(f.fullName) === n || norm(f.fullName).startsWith(n + " "))).slice(0, MAX_INSTALLED_FILES);
  const out: FontFile[] = [];
  for (const font of hits) {
    try {
      out.push({ bytes: new Uint8Array(await (await font.blob()).arrayBuffer()) });
    } catch {
      // A font that can't be read is skipped.
    }
  }
  return out;
}

// Must be called from a click: shows the browser's permission prompt. True when
// fonts can be read afterwards.
export async function allowInstalledFonts(): Promise<boolean> {
  if (!installedFontsSupported()) return false;
  try {
    await (window as WindowWithFonts).queryLocalFonts!();
    return true;
  } catch {
    return false;
  }
}

// ---- fonts the site owner hosts --------------------------------------------------------

// Optional: public/fonts/docx/custom/manifest.json maps a family name to font
// files in the same folder, for a site that holds a licence to serve them:
//   { "aptos": ["Aptos.ttf", "Aptos-Bold.ttf", "Aptos-Italic.ttf", "Aptos-BoldItalic.ttf"] }
// The folder is git-ignored; nothing is hosted by default.
const CUSTOM_BASE = "/fonts/docx/custom";
let manifest: Promise<Record<string, string[]>> | undefined;

export async function findHostedFonts(names: string[]): Promise<FontFile[]> {
  manifest ??= fetch(`${CUSTOM_BASE}/manifest.json`)
    .then((r) => (r.ok && /json/.test(r.headers.get("content-type") ?? "") ? (r.json() as Promise<Record<string, string[]>>) : {}))
    .catch(() => ({}));
  const map = await manifest;
  const out: FontFile[] = [];
  for (const name of names) {
    for (const file of map[norm(name)] ?? []) {
      try {
        const response = await fetch(`${CUSTOM_BASE}/${encodeURIComponent(file)}`);
        if (response.ok) out.push({ bytes: new Uint8Array(await response.arrayBuffer()) });
      } catch {
        // A missing file is skipped.
      }
    }
  }
  return out;
}
