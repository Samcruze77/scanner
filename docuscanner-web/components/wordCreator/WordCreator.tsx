"use client";

// Create Word Document: a blank A4 page, a formatting toolbar, local autosave and a real .docx download.
// Everything runs in this browser. Drafts are kept here (IndexedDB), not in an account, and nothing
// you write or insert is sent anywhere.

import "./word-creator.css";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TextAlign from "@tiptap/extension-text-align";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontSizeTools, PageBreak, ParagraphFormat, Pagination, WordImage } from "./extensions";
import { NavPad } from "./NavPad";
import { Toolbar } from "./Toolbar";
import { useMediaQuery } from "./useMediaQuery";
import { SignatureDialog } from "@/components/scanner/SignatureDialog";
import type { SignatureImage } from "@/utils/scanner/signature";
import { trackFeatureUsed, trackToolOpened } from "@/utils/analytics/events";
import { exportDocx, ExportError } from "@/utils/wordCreator/docxExport";
import {
  DraftCorruptError,
  newDraftId,
  openDraftStore,
  type DraftStore,
  type DraftSummary,
} from "@/utils/wordCreator/draftStore";
import { ImageProblem, prepareImage } from "@/utils/wordCreator/imageFile";
import { DEFAULT_MARGINS, DEFAULT_TITLE, EMPTY_DOC, isDocumentEmpty, pageViewGeometry, phoneViewGeometry, safeLinkHref, sanitizeFileName, type DocNode, type Margins } from "@/utils/wordCreator/model";

type Status = "ready" | "unsaved" | "saving" | "saved" | "error";
interface Notice {
  kind: "error" | "info";
  text: string;
}
interface Session {
  key: number;
  id: string;
  title: string;
  content: DocNode;
  margins: Margins;
  saved: boolean; // already in storage
}

const AUTOSAVE_MS = 800;
const ZOOMS = [50, 75, 100, 125, 150, 200];

function time(ms: number) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function WordCreator() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [storeKind, setStoreKind] = useState<"indexeddb" | "localstorage" | "none" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [store, setStore] = useState<DraftStore | null>(null);

  const storeRef = useRef<DraftStore | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const docRef = useRef<DocNode>(EMPTY_DOC);
  const [margins, setMargins] = useState<Margins>(DEFAULT_MARGINS);
  const marginsRef = useRef<Margins>(DEFAULT_MARGINS);
  const titleRef = useRef(DEFAULT_TITLE);
  const rev = useRef(0);
  const savedRev = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));
  const [status, setStatus] = useState<Status>("ready");
  const [statusText, setStatusText] = useState("");
  const statusRef = useRef<Status>("ready");
  const setSaveStatus = useCallback((s: Status, text = "") => {
    statusRef.current = s;
    setStatus(s);
    setStatusText(text);
  }, []);

  // ---- saving ---------------------------------------------------------------------------------------------------------
  const save = useCallback((): Promise<boolean> => {
    window.clearTimeout(timer.current);
    const run = async (): Promise<boolean> => {
      const store = storeRef.current;
      const current = sessionRef.current;
      if (!store || !current) return false;
      if (rev.current === savedRev.current) return statusRef.current !== "error";
      const snap = rev.current;
      const doc = docRef.current;
      const title = titleRef.current.trim() || DEFAULT_TITLE;
      // A page nobody has typed on is not worth a draft of its own.
      if (!current.saved && isDocumentEmpty(doc) && title === DEFAULT_TITLE) {
        savedRev.current = snap;
        setSaveStatus("ready");
        return true;
      }
      setSaveStatus("saving");
      try {
        await store.save(current.id, title, doc, marginsRef.current);
        current.saved = true;
        savedRev.current = snap;
        if (rev.current === snap) setSaveStatus("saved", `Saved in this browser at ${time(Date.now())}`);
        else setSaveStatus("unsaved");
        return true;
      } catch (e) {
        setSaveStatus("error", e instanceof Error ? e.message : "The draft could not be saved.");
        return false;
      }
    };
    queue.current = queue.current.then(run, run);
    return queue.current;
  }, [setSaveStatus]);

  const markChanged = useCallback(() => {
    rev.current++;
    setSaveStatus("unsaved");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
  }, [save, setSaveStatus]);

  // ---- starting up: open storage, restore the last draft ----------------------------------------------------------------
  useEffect(() => {
    void trackToolOpened("create_word_document");
    let cancelled = false;
    (async () => {
      const store = await openDraftStore();
      if (cancelled) return;
      storeRef.current = store;
      setStore(store);
      setStoreKind(store ? store.kind : "none");
      let next: Session = { key: 1, id: newDraftId(), title: DEFAULT_TITLE, content: EMPTY_DOC, margins: DEFAULT_MARGINS, saved: false };
      if (store) {
        try {
          const last = await store.getLastId();
          if (last) {
            const draft = await store.load(last);
            next = { key: 1, id: draft.id, title: draft.title, content: draft.content, margins: draft.margins, saved: true };
            if (draft.lostImages) setNotice({ kind: "error", text: `${draft.lostImages} picture${draft.lostImages > 1 ? "s" : ""} in your last draft could not be recovered and ${draft.lostImages > 1 ? "were" : "was"} left out.` });
            else setNotice({ kind: "info", text: "Your last draft was restored from this browser." });
          }
        } catch (e) {
          if (e instanceof DraftCorruptError) setNotice({ kind: "error", text: "Your last draft could not be read, so a blank page was opened. The damaged draft is still listed under My drafts, where you can delete it." });
          else setNotice({ kind: "error", text: "Saved drafts could not be opened in this browser. You can still write and download your document." });
        }
      }
      if (cancelled) return;
      sessionRef.current = next;
      docRef.current = next.content;
      titleRef.current = next.title;
      marginsRef.current = next.margins;
      setMargins(next.margins);
      rev.current = savedRev.current = 0;
      setSession(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Never lose the last few keystrokes: save when the tab is hidden or the page is left.
  useEffect(() => {
    const flush = () => {
      if (rev.current !== savedRev.current) void save();
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    const onUnload = (e: BeforeUnloadEvent) => {
      flush();
      const unrecoverable = !storeRef.current && !isDocumentEmpty(docRef.current);
      if (rev.current !== savedRev.current || statusRef.current === "error" || unrecoverable) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", onUnload);
      flush(); // leaving this page inside the app
      window.clearTimeout(timer.current);
    };
  }, [save]);

  // ---- session changes: new document, open a draft ----------------------------------------------------------------------------
  const beginSession = useCallback(
    (next: Omit<Session, "key">) => {
      const s: Session = { ...next, key: (sessionRef.current?.key ?? 0) + 1 };
      sessionRef.current = s;
      docRef.current = s.content;
      titleRef.current = s.title;
      marginsRef.current = s.margins;
      setMargins(s.margins);
      rev.current = savedRev.current = 0;
      setSaveStatus("ready");
      setSession(s);
    },
    [setSaveStatus],
  );

  // Saves what is on the page; if that fails, asks before anything is replaced.
  const keepCurrentWork = useCallback(async (): Promise<boolean> => {
    const ok = await save();
    if (ok) return true;
    if (isDocumentEmpty(docRef.current) && rev.current === savedRev.current) return true;
    return window.confirm("Your current document could not be saved in this browser. If you continue it will be lost. Choose Cancel, then use Download Word (.docx) to keep a copy.\n\nContinue anyway?");
  }, [save]);

  const startNew = useCallback(async () => {
    if (!(await keepCurrentWork())) return;
    setNotice({ kind: "info", text: "New blank document. Your previous document is kept under My drafts." });
    beginSession({ id: newDraftId(), title: DEFAULT_TITLE, content: EMPTY_DOC, margins: DEFAULT_MARGINS, saved: false });
  }, [beginSession, keepCurrentWork]);

  const openDraft = useCallback(
    async (id: string) => {
      const store = storeRef.current;
      if (!store) return;
      if (id === sessionRef.current?.id) return setDraftsOpen(false);
      if (!(await keepCurrentWork())) return;
      try {
        const draft = await store.load(id);
        beginSession({ id: draft.id, title: draft.title, content: draft.content, margins: draft.margins, saved: true });
        setNotice(draft.lostImages ? { kind: "error", text: `${draft.lostImages} picture(s) in that draft could not be recovered.` } : null);
        setDraftsOpen(false);
      } catch (e) {
        setNotice({ kind: "error", text: e instanceof DraftCorruptError ? "That draft is damaged and could not be opened. You can delete it." : "That draft could not be opened." });
      }
    },
    [beginSession, keepCurrentWork],
  );

  const deleteDraft = useCallback(
    async (id: string) => {
      const store = storeRef.current;
      if (!store) return;
      try {
        await store.remove(id);
      } catch {
        setNotice({ kind: "error", text: "The draft could not be deleted." });
        return;
      }
      if (id === sessionRef.current?.id) beginSession({ id: newDraftId(), title: DEFAULT_TITLE, content: EMPTY_DOC, margins: DEFAULT_MARGINS, saved: false });
    },
    [beginSession],
  );

  // ---- leaving ----------------------------------------------------------------------------------------------------------------------
  const onBack = async (e: React.MouseEvent) => {
    if (rev.current === savedRev.current && statusRef.current !== "error") return;
    e.preventDefault();
    if (await keepCurrentWork()) router.push("/tools");
  };

  if (!session) {
    return (
      <p className="text-sm" role="status" style={{ color: "var(--text-2)" }}>
        Opening your page…
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="wc-docbar flex flex-wrap items-center gap-2">
        <Link href="/tools" onClick={onBack} className="btn btn-ghost px-3">
          <span aria-hidden>←</span> Back to tools
        </Link>
        <label className="min-w-[12rem] flex-1">
          <span className="sr-only">Document name</span>
          <input
            key={session.key}
            className="field font-medium"
            defaultValue={session.title}
            maxLength={150}
            aria-label="Document name"
            data-assistant-id="wc-title"
            placeholder={DEFAULT_TITLE}
            onChange={(e) => {
              titleRef.current = e.target.value;
              markChanged();
            }}
            onBlur={(e) => {
              if (!e.target.value.trim()) {
                e.target.value = DEFAULT_TITLE;
                titleRef.current = DEFAULT_TITLE;
                markChanged();
              }
            }}
          />
        </label>
        <SaveStatus status={status} text={statusText} storage={storeKind} />
      </div>
      <Editing
        key={session.key}
        session={session}
        margins={margins}
        onMargins={(m) => {
          marginsRef.current = m;
          setMargins(m);
          markChanged();
        }}
        storeKind={storeKind}
        notice={notice}
        clearNotice={() => setNotice(null)}
        setNotice={setNotice}
        onDocChange={(doc) => {
          docRef.current = doc;
          markChanged();
        }}
        save={save}
        getTitle={() => titleRef.current.trim() || DEFAULT_TITLE}
        startNew={startNew}
        openDrafts={() => setDraftsOpen(true)}
        status={status}
      />
      {draftsOpen && store && <DraftsDialog store={store} currentId={session.id} onClose={() => setDraftsOpen(false)} onOpen={openDraft} onDelete={deleteDraft} />}
    </div>
  );
}

function SaveStatus({ status, text, storage }: { status: Status; text: string; storage: "indexeddb" | "localstorage" | "none" | null }) {
  const label =
    storage === "none" && status !== "error"
      ? "Not saved: this browser can't keep drafts. Download to keep your work."
      : status === "saving"
        ? "Saving…"
        : status === "saved"
          ? text
          : status === "unsaved"
            ? "Unsaved changes"
            : status === "error"
              ? `Save failed. ${text}`
              : "Drafts are saved in this browser as you type";
  const color = status === "error" || storage === "none" ? "var(--error-text)" : status === "saved" ? "var(--success-text)" : "var(--text-2)";
  return (
    <p role="status" aria-live="polite" data-save-status={status} className="max-w-full text-sm" style={{ color }}>
      {label}
    </p>
  );
}

// ---- the page and toolbar -----------------------------------------------------------------------------------------------------------
function Editing({
  session,
  margins,
  onMargins,
  storeKind,
  notice,
  clearNotice,
  setNotice,
  onDocChange,
  save,
  getTitle,
  startNew,
  openDrafts,
  status,
}: {
  session: Session;
  margins: Margins;
  onMargins: (m: Margins) => void;
  storeKind: "indexeddb" | "localstorage" | "none" | null;
  notice: Notice | null;
  clearNotice: () => void;
  setNotice: (n: Notice | null) => void;
  onDocChange: (doc: DocNode) => void;
  save: () => Promise<boolean>;
  getTitle: () => string;
  startNew: () => void;
  openDrafts: () => void;
  status: Status;
}) {
  const phone = useMediaQuery("(max-width: 767px)");
  const [pages, setPages] = useState(1);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  // On a phone the sheet is drawn as wide as the screen so the text stays readable ("phone view"); "page view" shows the real A4 sheet.
  const [phoneView, setPhoneView] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const [deskWidth, setDeskWidth] = useState(1000);
  const [keyboard, setKeyboard] = useState(0);
  const [busyImage, setBusyImage] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [signing, setSigning] = useState(false);
  const [lastSignature, setLastSignature] = useState<SignatureImage | null>(null);
  const deskRef = useRef<HTMLDivElement>(null);
  const [dockEl, setDockEl] = useState<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const addImagesRef = useRef<(files: File[]) => void>(() => {});
  const saveRef = useRef(save);
  const onDocChangeRef = useRef(onDocChange);
  useEffect(() => {
    saveRef.current = save;
    onDocChangeRef.current = onDocChange;
  });
  const narrowView = phone && phoneView;

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        blockquote: false,
        codeBlock: false,
        code: false,
        heading: { levels: [1, 2, 3] },
        // Only web, mail and phone links: a pasted `javascript:` address is dropped.
        link: { openOnClick: false, autolink: true, isAllowedUri: (url: string) => !!safeLinkHref(url) },
      }),
      TextStyleKit.configure({ lineHeight: false, backgroundColor: false }),
      Highlight.configure({ multicolor: true }),
      Subscript,
      Superscript,
      TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"], defaultAlignment: "left" }),
      ParagraphFormat,
      FontSizeTools,
      PageBreak,
      WordImage,
      Pagination.configure({ onPages: (n: number) => setPages(n) }),
    ],
    [],
  );

  const syncEmpty = (e: Editor) => e.view.dom.classList.toggle("wc-empty", e.isEmpty);

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: session.content,
    autofocus: "start",
    editorProps: {
      attributes: { class: "wc-page", role: "textbox", "aria-multiline": "true", "aria-label": "Document body", spellcheck: "true" },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();
        addImagesRef.current(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
        if (!files.length) return false;
        event.preventDefault();
        addImagesRef.current(files);
        return true;
      },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "s") {
          event.preventDefault();
          void saveRef.current();
          return true;
        }
        return false;
      },
    },
    onCreate: ({ editor: e }) => {
      editorRef.current = e;
      syncEmpty(e);
    },
    onUpdate: ({ editor: e }) => {
      syncEmpty(e);
      onDocChangeRef.current(e.getJSON() as DocNode);
    },
  });

  const addImages = async (files: File[]) => {
    if (!editor) return;
    setBusyImage(true);
    const problems: string[] = [];
    let added = 0;
    for (const file of files) {
      try {
        const img = await prepareImage(file);
        editor.chain().focus().insertPicture(img).run();
        added++;
      } catch (e) {
        problems.push(e instanceof ImageProblem ? e.message : "A picture could not be added.");
      }
    }
    setBusyImage(false);
    if (problems.length) setNotice({ kind: "error", text: [...new Set(problems)].join(" ") });
    else if (added) clearNotice();
  };
  useEffect(() => {
    addImagesRef.current = addImages;
  });

  // The room the sheet has.
  useEffect(() => {
    const el = deskRef.current;
    if (!el) return;
    const measure = () => setDeskWidth(el.clientWidth - parseFloat(getComputedStyle(el).paddingLeft) - parseFloat(getComputedStyle(el).paddingRight));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // What is drawn: the real A4 sheet with the chosen margins, or (phone view) a sheet as wide as the screen.
  const geometry = useMemo(() => (narrowView ? phoneViewGeometry(margins, deskWidth) : pageViewGeometry(margins)), [narrowView, margins, deskWidth]);
  useEffect(() => {
    editor?.commands.setPageGeometry(geometry);
  }, [editor, geometry]);

  const fitScale = Math.min(1, Math.max(0.3, deskWidth / geometry.pageW));
  const scale = narrowView ? 1 : zoom === "fit" ? fitScale : zoom / 100;
  const paperH = pages * geometry.pageH + (pages - 1) * geometry.gap;

  // On-screen keyboard: how much of the layout viewport it covers, so the bottom bar and sheets sit above it.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      const root = document.documentElement.style;
      root.setProperty("--wc-kb", `${inset > 80 ? inset : 0}px`);
      root.setProperty("--wc-vvh", `${vv.height}px`);
      setKeyboard(inset > 80 ? inset : 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.documentElement.style.removeProperty("--wc-kb");
      document.documentElement.style.removeProperty("--wc-vvh");
    };
  }, []);

  // Pulling down at the top of the page must not reload it (and lose the selection) while someone is writing.
  useEffect(() => {
    const root = document.documentElement.style;
    const before = root.overscrollBehaviorY;
    root.overscrollBehaviorY = "contain";
    return () => {
      root.overscrollBehaviorY = before;
    };
  }, []);

  // Keep the caret on screen: above the bottom bar and the on-screen keyboard, below the top of the screen.
  useEffect(() => {
    if (!editor || !phone) return;
    let frame = 0;
    const ensure = () => {
      frame = 0;
      if (!editor.view.hasFocus()) return;
      const vv = window.visualViewport;
      const dock = dockEl?.getBoundingClientRect();
      const bottomLimit = (dock && dock.height > 0 ? dock.top : (vv ? vv.offsetTop + vv.height : window.innerHeight)) - 12;
      const topLimit = (vv?.offsetTop ?? 0) + 64;
      const c = editor.view.coordsAtPos(editor.state.selection.head);
      if (c.bottom > bottomLimit) window.scrollBy({ top: c.bottom - bottomLimit, behavior: "auto" });
      else if (c.top < topLimit) window.scrollBy({ top: c.top - topLimit, behavior: "auto" });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(ensure);
    };
    editor.on("selectionUpdate", schedule);
    editor.on("update", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      editor.off("selectionUpdate", schedule);
      editor.off("update", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [editor, phone, dockEl]);

  const download = async () => {
    if (!editor || downloading) return;
    setDownloading(true);
    try {
      const title = getTitle();
      const bytes = await exportDocx(editor.getJSON() as DocNode, { title, margins });
      const mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const blob = new Blob([bytes as BlobPart], { type: mime });
      const name = sanitizeFileName(title);
      if (!("download" in HTMLAnchorElement.prototype)) {
        // A browser that cannot save a file from a link: offer the share sheet, or open the file.
        const file = new File([blob], name, { type: mime });
        if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title });
        else window.open(URL.createObjectURL(blob), "_blank");
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
      void trackFeatureUsed("word_document_downloaded");
      setNotice({ kind: "info", text: phone ? `Downloaded ${name}. If you cannot find it, open your browser's Downloads.` : `Downloaded ${name}.` });
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return; // the share sheet was closed
      setNotice({ kind: "error", text: e instanceof ExportError ? e.message : "The Word file could not be created. Your text is still here; try again." });
    } finally {
      setDownloading(false);
    }
  };

  const words = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const text = e ? e.state.doc.textBetween(0, e.state.doc.content.size, " ", " ").trim() : "";
      return text ? text.split(/\s+/).length : 0;
    },
  });

  const saveLabel = status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "error" ? "Retry save" : "Save";
  const dockBottom = keyboard > 0 ? `${keyboard}px` : "calc(3.5rem + env(safe-area-inset-bottom))";

  const moreExtras = (
    <div className="grid gap-3">
      <div>
        <p className="panel-title mb-1">View</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary min-h-10" aria-pressed={phoneView} onClick={() => setPhoneView(true)}>
            Phone view
          </button>
          <button type="button" className="btn btn-secondary min-h-10" aria-pressed={!phoneView} onClick={() => setPhoneView(false)}>
            Page view
          </button>
        </div>
        <p className="muted mt-1 text-xs">Phone view keeps the text a readable size. Page view shows the whole A4 sheet; zoom in with the browser to read it.</p>
      </div>
      <div>
        <p className="panel-title mb-1">Move through the document</p>
        <button type="button" className="btn btn-secondary min-h-10" aria-pressed={navOpen} onClick={() => setNavOpen((v) => !v)}>
          {navOpen ? "Hide navigation keys" : "Show navigation keys"}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className="wc-docbar flex flex-wrap items-center gap-2">
        {!phone && (
          <button type="button" data-assistant-id="wc-save" className="btn btn-secondary" onClick={() => void save()} disabled={status === "saving"}>
            Save now
          </button>
        )}
        <button type="button" data-assistant-id="wc-new" className="btn btn-secondary" onClick={startNew}>
          New document
        </button>
        {storeKind !== "none" && (
          <button type="button" className="btn btn-secondary" onClick={openDrafts}>
            My drafts
          </button>
        )}
        {!phone && (
          <button type="button" data-assistant-id="wc-download" className="btn btn-primary ml-auto" onClick={() => void download()} disabled={!editor || downloading}>
            {downloading ? "Preparing…" : "Download Word (.docx)"}
          </button>
        )}
      </div>

      {notice && (
        <div role={notice.kind === "error" ? "alert" : "status"} className={`notice ${notice.kind === "error" ? "notice-error" : "notice-info"} flex items-start justify-between gap-3`}>
          <span>{notice.text}</span>
          <button type="button" className="shrink-0 underline" onClick={clearNotice}>
            Dismiss
          </button>
        </div>
      )}

      {editor && (
        <Toolbar
          editor={editor}
          margins={margins}
          onMargins={onMargins}
          busyImage={busyImage}
          onPickImage={() => fileRef.current?.click()}
          onAddSignature={() => setSigning(true)}
          moreExtras={moreExtras}
          dock={{
            setEl: setDockEl,
            bottom: dockBottom,
            above: navOpen ? <NavPad editor={editor} /> : null,
            end: (
              <>
                <button type="button" data-assistant-id="wc-save" className="wc-tbtn" aria-label={status === "saving" ? "Saving" : status === "error" ? "Save failed: retry" : "Save now"} data-dock-status={status} onClick={() => void save()} disabled={status === "saving"}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 4h11l3 3v13H5z" />
                    <path d="M8 4v5h7V4M8 20v-6h8v6" />
                  </svg>
                  <span>{saveLabel}</span>
                </button>
                <button type="button" data-assistant-id="wc-download" className="wc-tbtn wc-primary" aria-label="Download Word (.docx)" onClick={() => void download()} disabled={!editor || downloading}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
                  </svg>
                  <span>{downloading ? "Preparing…" : "Download"}</span>
                </button>
              </>
            ),
          }}
        />
      )}
      {signing && editor && (
        <SignatureDialog
          lastSignature={lastSignature}
          onCancel={() => {
            setSigning(false);
            editor.commands.focus();
          }}
          onApply={(sig) => {
            setLastSignature(sig);
            setSigning(false);
            // The signature is a transparent PNG, placed like any picture: moved, resized and aligned with the picture controls.
            editor.chain().focus().insertPicture({ src: sig.dataUrl, width: Math.min(220, sig.width), alt: "Signature" }).run();
          }}
        />
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        hidden
        aria-label="Choose pictures to insert"
        data-testid="wc-image-input"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) addImagesRef.current(files);
        }}
      />

      <div className="wc-desk" ref={deskRef} data-testid="wc-desk" data-view={narrowView ? "phone" : "page"}>
        <div className="wc-scaler" style={{ width: geometry.pageW * scale, height: paperH * scale }}>
          <div
            className="wc-scaled"
            style={{
              transform: scale === 1 ? undefined : `scale(${scale})`,
              ["--wc-w" as string]: `${geometry.pageW}px`,
              ["--wc-h" as string]: `${geometry.pageH}px`,
              ["--wc-gap" as string]: `${geometry.gap}px`,
              ["--wc-mt" as string]: `${geometry.mt}px`,
              ["--wc-mr" as string]: `${geometry.mr}px`,
              ["--wc-mb" as string]: `${geometry.mb}px`,
              ["--wc-ml" as string]: `${geometry.ml}px`,
              ["--wc-paper-h" as string]: `${paperH}px`,
            }}
          >
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      <div className="wc-docbar flex flex-wrap items-center justify-between gap-2 text-sm" style={{ color: "var(--text-2)" }}>
        <p data-testid="wc-counter">
          {narrowView ? "Pages (about)" : "Page count"}: {pages} · {words} word{words === 1 ? "" : "s"}
        </p>
        {!narrowView && (
          <div className="flex items-center gap-1" role="group" aria-label="Zoom">
            <button type="button" className="btn btn-ghost px-3" aria-label="Zoom out" onClick={() => setZoom(Math.max(25, Math.round(scale * 100) - 10))}>
              −
            </button>
            <select className="wc-select" aria-label="Zoom level" value={zoom === "fit" ? "fit" : String(zoom)} onChange={(e) => setZoom(e.target.value === "fit" ? "fit" : Number(e.target.value))}>
              <option value="fit">Fit width ({Math.round(fitScale * 100)}%)</option>
              {ZOOMS.map((z) => (
                <option key={z} value={z}>
                  {z}%
                </option>
              ))}
              {typeof zoom === "number" && !ZOOMS.includes(zoom) && <option value={zoom}>{zoom}%</option>}
            </select>
            <button type="button" className="btn btn-ghost px-3" aria-label="Zoom in" onClick={() => setZoom(Math.min(300, Math.round(scale * 100) + 10))}>
              +
            </button>
          </div>
        )}
      </div>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        Your document and pictures stay in this browser: nothing is uploaded. Drafts live on this device only (they are not saved to an account), so download the .docx to keep or share a copy. Word lays pages out with its own engine, so line and page breaks can differ slightly from this view
        {narrowView ? ", and phone view draws a narrower sheet than the A4 page Word will print" : ""}.
      </p>
      {phone && <div aria-hidden style={{ height: navOpen ? "11rem" : "7rem" }} />}
    </>
  );
}

// ---- drafts list -----------------------------------------------------------------------------------------------------------------------
function DraftsDialog({ store, currentId, onClose, onOpen, onDelete }: { store: DraftStore; currentId: string; onClose: () => void; onOpen: (id: string) => void; onDelete: (id: string) => Promise<void> }) {
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const refresh = useCallback(() => void store.list().then(setDrafts, () => setDrafts([])), [store]);

  useEffect(() => {
    refresh();
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [refresh, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "var(--scrim)" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="wc-drafts-title" className="card max-h-[80vh] w-full max-w-lg overflow-auto p-4 shadow-xl" style={{ background: "var(--elevated)" }}>
        <div className="flex items-center justify-between gap-2">
          <h2 id="wc-drafts-title" className="section-title">
            My drafts
          </h2>
          <button type="button" className="btn btn-ghost px-3" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="muted mt-1 text-sm">Kept in this browser only. Starting a new document never deletes these.</p>
        {drafts === null ? (
          <p className="mt-4 text-sm">Loading…</p>
        ) : drafts.length === 0 ? (
          <p className="mt-4 text-sm">No saved drafts yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {drafts.map((d) => (
              <li key={d.id} className="card flex items-center gap-2 p-3" data-draft-id={d.id}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{d.readable ? d.title : `${d.title} (damaged)`}</p>
                  <p className="muted text-xs">
                    {d.readable ? `${d.words} word${d.words === 1 ? "" : "s"} · ` : ""}
                    {d.updatedAt ? new Date(d.updatedAt).toLocaleString() : ""}
                    {d.id === currentId ? " · open now" : ""}
                  </p>
                </div>
                {d.readable && d.id !== currentId && (
                  <button type="button" className="btn btn-secondary px-3" onClick={() => onOpen(d.id)}>
                    Open
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-danger px-3"
                  onClick={async () => {
                    if (!window.confirm(`Delete the draft "${d.title}" from this browser? This can't be undone.`)) return;
                    await onDelete(d.id);
                    refresh();
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
