// Local drafts for the Word document creator. Everything stays in THIS browser: nothing is sent to a
// server and nothing here is an account feature.
//
// IndexedDB holds the text (a small JSON tree) and, separately, each picture's own bytes, keyed by a
// hash so the same picture is stored once and an autosave never rewrites a big picture. If
// IndexedDB is unavailable (some private modes) a localStorage store keeps the text and pictures
// together, and says so when it runs out of room.
import { countWords, EMPTY_DOC, DEFAULT_TITLE, type DocNode } from "./model.ts";

export interface DraftSummary {
  id: string;
  title: string;
  updatedAt: number;
  words: number;
  readable: boolean;
}

export interface LoadedDraft {
  id: string;
  title: string;
  content: DocNode;
  updatedAt: number;
  // Pictures that could not be found in storage and were left out of the restored document.
  lostImages: number;
}

export interface DraftStore {
  kind: "indexeddb" | "localstorage";
  list(): Promise<DraftSummary[]>;
  load(id: string): Promise<LoadedDraft>;
  save(id: string, title: string, content: DocNode): Promise<void>;
  remove(id: string): Promise<void>;
  getLastId(): Promise<string | null>;
}

export class DraftCorruptError extends Error {}
export class DraftStorageError extends Error {
  constructor(
    message: string,
    readonly reason: "quota" | "unavailable" | "other",
  ) {
    super(message);
  }
}

export function classifyStorageError(e: unknown): DraftStorageError {
  if (e instanceof DraftStorageError) return e;
  const name = (e as { name?: string } | null)?.name ?? "";
  const code = (e as { code?: number } | null)?.code;
  if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014) {
    return new DraftStorageError("This browser has no room left to keep your draft. Download the document now, then free some space or delete old drafts.", "quota");
  }
  if (name === "SecurityError" || name === "InvalidStateError" || name === "NotFoundError") {
    return new DraftStorageError("This browser is not allowing drafts to be stored (private browsing or blocked site data). Download the document to keep it.", "unavailable");
  }
  return new DraftStorageError("The draft could not be saved in this browser. Download the document to keep it.", "other");
}

export function newDraftId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// ---- pictures <-> references ------------------------------------------------------------------------------------------
const REF = "fps-img:";

function dataUrlParts(src: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:(image\/[a-z.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(src);
  if (!m) return null;
  const bin = atob(m[2].replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: m[1], bytes };
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (const b of bytes) {
    h1 = Math.imul(h1 ^ b, 2654435761);
    h2 = Math.imul(h2 ^ b, 1597334677);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}${bytes.length.toString(16)}`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function mapNodes(node: DocNode, fn: (n: DocNode) => Promise<DocNode | null>): Promise<DocNode | null> {
  const mapped = await fn(node);
  if (!mapped) return null;
  if (!mapped.content) return mapped;
  const content: DocNode[] = [];
  for (const child of mapped.content) {
    const next = await mapNodes(child, fn);
    if (next) content.push(next);
  }
  return { ...mapped, content };
}

export function isDocShape(value: unknown): value is DocNode {
  const ok = (n: unknown, depth: number): boolean => {
    if (!n || typeof n !== "object" || depth > 40) return false;
    const node = n as DocNode;
    if (typeof node.type !== "string") return false;
    if (node.content !== undefined && (!Array.isArray(node.content) || !node.content.every((c) => ok(c, depth + 1)))) return false;
    if (node.text !== undefined && typeof node.text !== "string") return false;
    return true;
  };
  return ok(value, 0) && (value as DocNode).type === "doc" && Array.isArray((value as DocNode).content);
}

interface DraftRow {
  id: string;
  title: string;
  updatedAt: number;
  content: DocNode;
  imageIds: string[];
}

// ---- IndexedDB ---------------------------------------------------------------------------------------------------------------
const DB_NAME = "freepdfscanner-word-creator";

function requestResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException("aborted", "AbortError"));
  });
}

class IndexedDbStore implements DraftStore {
  kind = "indexeddb" as const;
  private known = new Set<string>(); // picture ids already written in this session
  private hashes = new Map<string, string>(); // data URL -> id (avoids re-hashing every autosave)

  constructor(private db: IDBDatabase) {}

  static open(): Promise<IndexedDbStore> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("drafts", { keyPath: "id" });
        db.createObjectStore("images", { keyPath: "id" });
        db.createObjectStore("meta", { keyPath: "key" });
      };
      req.onsuccess = () => resolve(new IndexedDbStore(req.result));
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new DOMException("blocked", "InvalidStateError"));
    });
  }

  async list(): Promise<DraftSummary[]> {
    const rows = await requestResult(this.db.transaction("drafts").objectStore("drafts").getAll() as IDBRequest<DraftRow[]>);
    return rows
      .map((r) => {
        const readable = isDocShape(r?.content);
        return { id: String(r?.id), title: String(r?.title ?? DEFAULT_TITLE), updatedAt: Number(r?.updatedAt) || 0, words: readable ? countWords(r.content) : 0, readable };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string): Promise<LoadedDraft> {
    const row = (await requestResult(this.db.transaction("drafts").objectStore("drafts").get(id))) as DraftRow | undefined;
    if (!row || !isDocShape(row.content)) throw new DraftCorruptError("This draft could not be read.");
    let lost = 0;
    const store = this.db.transaction("images").objectStore("images");
    const resolved = await mapNodes(row.content, async (n) => {
      if (n.type !== "image" || typeof n.attrs?.src !== "string" || !n.attrs.src.startsWith(REF)) return n;
      const rec = (await requestResult(store.get(n.attrs.src.slice(REF.length)))) as { blob: Blob } | undefined;
      if (!rec?.blob) {
        lost++;
        return null;
      }
      return { ...n, attrs: { ...n.attrs, src: await blobToDataUrl(rec.blob) } };
    });
    return { id, title: typeof row.title === "string" ? row.title : DEFAULT_TITLE, content: resolved ?? EMPTY_DOC, updatedAt: row.updatedAt, lostImages: lost };
  }

  async save(id: string, title: string, content: DocNode): Promise<void> {
    try {
      const fresh: { id: string; blob: Blob }[] = [];
      const imageIds = new Set<string>();
      const stored = await mapNodes(content, async (n) => {
        if (n.type !== "image" || typeof n.attrs?.src !== "string") return n;
        const src = n.attrs.src;
        if (src.startsWith(REF)) return n;
        let picId = this.hashes.get(src);
        if (!picId) {
          const parts = dataUrlParts(src);
          if (!parts) return n;
          picId = await hashBytes(parts.bytes);
          this.hashes.set(src, picId);
          if (!this.known.has(picId)) fresh.push({ id: picId, blob: new Blob([parts.bytes as BlobPart], { type: parts.mime }) });
        } else if (!this.known.has(picId)) {
          const parts = dataUrlParts(src);
          if (parts) fresh.push({ id: picId, blob: new Blob([parts.bytes as BlobPart], { type: parts.mime }) });
        }
        imageIds.add(picId);
        return { ...n, attrs: { ...n.attrs, src: REF + picId } };
      });
      const tx = this.db.transaction(["drafts", "images", "meta"], "readwrite");
      const images = tx.objectStore("images");
      for (const f of fresh) images.put(f);
      tx.objectStore("drafts").put({ id, title, updatedAt: Date.now(), content: stored, imageIds: [...imageIds] } satisfies DraftRow);
      tx.objectStore("meta").put({ key: "last", value: id });
      await txDone(tx);
      for (const f of fresh) this.known.add(f.id);
      await this.collectPictures();
    } catch (e) {
      throw classifyStorageError(e);
    }
  }

  async remove(id: string): Promise<void> {
    try {
      const tx = this.db.transaction(["drafts", "meta"], "readwrite");
      tx.objectStore("drafts").delete(id);
      const meta = tx.objectStore("meta");
      const last = (await requestResult(meta.get("last"))) as { value?: string } | undefined;
      if (last?.value === id) meta.delete("last");
      await txDone(tx);
      await this.collectPictures();
    } catch (e) {
      throw classifyStorageError(e);
    }
  }

  async getLastId(): Promise<string | null> {
    const rec = (await requestResult(this.db.transaction("meta").objectStore("meta").get("last"))) as { value?: string } | undefined;
    return rec?.value ?? null;
  }

  // Deletes pictures no draft refers to any more.
  private async collectPictures(): Promise<void> {
    const rows = await requestResult(this.db.transaction("drafts").objectStore("drafts").getAll() as IDBRequest<DraftRow[]>);
    const used = new Set(rows.flatMap((r) => (Array.isArray(r.imageIds) ? r.imageIds : [])));
    const tx = this.db.transaction("images", "readwrite");
    const keys = (await requestResult(tx.objectStore("images").getAllKeys())) as string[];
    for (const k of keys) {
      if (!used.has(k)) {
        tx.objectStore("images").delete(k);
        this.known.delete(k);
      }
    }
    await txDone(tx);
  }
}

// ---- localStorage fallback --------------------------------------------------------------------------------------------------
const LS = "fps-wc:";

class LocalStorageStore implements DraftStore {
  kind = "localstorage" as const;

  private rows(): { key: string; row: DraftRow | null }[] {
    const out: { key: string; row: DraftRow | null }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(LS + "draft:")) continue;
      try {
        out.push({ key, row: JSON.parse(localStorage.getItem(key) ?? "null") });
      } catch {
        out.push({ key, row: null });
      }
    }
    return out;
  }

  async list(): Promise<DraftSummary[]> {
    return this.rows()
      .map(({ key, row }) => {
        const readable = isDocShape(row?.content);
        return { id: key.slice((LS + "draft:").length), title: String(row?.title ?? DEFAULT_TITLE), updatedAt: Number(row?.updatedAt) || 0, words: readable ? countWords(row!.content) : 0, readable };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string): Promise<LoadedDraft> {
    let row: DraftRow | null = null;
    try {
      row = JSON.parse(localStorage.getItem(LS + "draft:" + id) ?? "null");
    } catch {
      /* corrupt */
    }
    if (!row || !isDocShape(row.content)) throw new DraftCorruptError("This draft could not be read.");
    return { id, title: typeof row.title === "string" ? row.title : DEFAULT_TITLE, content: row.content, updatedAt: row.updatedAt, lostImages: 0 };
  }

  async save(id: string, title: string, content: DocNode): Promise<void> {
    try {
      localStorage.setItem(LS + "draft:" + id, JSON.stringify({ id, title, updatedAt: Date.now(), content, imageIds: [] } satisfies DraftRow));
      localStorage.setItem(LS + "last", id);
    } catch (e) {
      throw classifyStorageError(e);
    }
  }

  async remove(id: string): Promise<void> {
    localStorage.removeItem(LS + "draft:" + id);
    if (localStorage.getItem(LS + "last") === id) localStorage.removeItem(LS + "last");
  }

  async getLastId(): Promise<string | null> {
    return localStorage.getItem(LS + "last");
  }
}

// ---- choosing a store ---------------------------------------------------------------------------------------------------------
export async function openDraftStore(): Promise<DraftStore | null> {
  try {
    if (typeof indexedDB !== "undefined" && indexedDB) return await IndexedDbStore.open();
  } catch {
    /* fall through to localStorage */
  }
  try {
    const probe = LS + "probe";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return new LocalStorageStore();
  } catch {
    return null;
  }
}
