"use client";

// Protect PDF / Word / Excel / PowerPoint. Pick a PDF, an Office file (Word, Excel or PowerPoint, including the
// macro-enabled and template versions), an Office "XML Document" (converted to the package it describes), or a JPG/PNG/WebP
// picture (which becomes a one-page PDF), choose a password, and download the locked copy.
// No account is needed and nothing leaves the device: PDFs go into a WebAssembly PDF
// engine in this tab, and Office files are encrypted with the browser's own Web Crypto.
//
// Safety rules this component keeps:
//  - The chosen File is only ever read. It stays selected and untouched through every
//    success, failure and cancellation.
//  - Each run gets a new operation id; a result from any other run is ignored, so a slow,
//    cancelled or failed run can never fill in (or replace) another run's download.
//  - A download is offered only from a run that finished AND verified. Starting a new run
//    discards the previous result; a failed run leaves none.
//  - Passwords are cleared as soon as a run ends for any reason, and on unmount.
//  - Analytics only ever carry the kind of file, timings and a failure code. Never the
//    file, its name or any password.

import { useEffect, useRef, useState } from "react";
import { FileDropzone } from "@/components/convert/FileDropzone";
import { PasswordField } from "@/components/auth/PasswordField";
import { ErrorBanner } from "@/components/scanner/ErrorBanner";
import { Icon } from "@/components/ui/icons";
import { useAuth } from "@/components/auth/AuthProvider";
import { trackDocumentDownloaded, trackProtectCompleted, trackProtectFailed, trackProtectStarted } from "@/utils/analytics/events";
import { downloadBlob } from "@/utils/convert/download";
import { formatBytes } from "@/utils/compress/types";
import { getUserPlan, isFeatureAvailable } from "@/utils/features/plans";
import { OFFICE_APP_NOUN, OFFICE_EXTENSIONS, OFFICE_TYPES, officeAppOf, officeExtensionOf, type OfficeApp, type OfficeExtension } from "@/utils/protect/office";
import { protectErrorMessage } from "@/utils/protect/messages";
import { DEFAULT_PROTECT_OPTIONS, MIN_PASSWORD_LENGTH, protectedFilename, validatePassword } from "@/utils/protect/protect";
import { toProtectError, type ProtectPhase } from "@/utils/protect/operation";

type Kind = "pdf" | "office" | "image";
type Focus = "pdf" | OfficeApp;

type Stage =
  | { name: "idle" }
  | { name: "ready"; file: File; kind: Kind }
  | { name: "working"; file: File; kind: Kind; phase: ProtectPhase; progress: number }
  | { name: "done"; file: File; kind: Kind; blob: Blob; filename: string; noun: string; app: OfficeApp | null };

interface FieldErrors {
  password?: string;
  confirm?: string;
}

const PHASE_LABEL: Record<ProtectPhase, string> = {
  validating: "Checking your document…",
  encrypting: "Protecting your document on this device…",
  verifying: "Checking the protected copy opens only with your password…",
  completed: "Done",
};

const APP_NAME: Record<OfficeApp, string> = { word: "Word", excel: "Excel", powerpoint: "PowerPoint" };

// Every file type the page accepts when the Office options are on.
const OFFICE_ACCEPT = [...OFFICE_EXTENSIONS.map((e) => `.${e}`), ...OFFICE_EXTENSIONS.map((e) => OFFICE_TYPES[e].mime), ".xml"].join(",");

function outputFilename(file: File, kind: Kind, extension: string): string {
  if (kind !== "office") return protectedFilename(file.name);
  const base = file.name.replace(/\.[^.]+$/, "").replace(/[^\w\- .()]+/g, "_").trim();
  // The protected copy keeps the file's own type (.docx, .xlsx, .pptx, .docm, ...); an XML Document
  // becomes the Office file it describes.
  return `${base || "document"}-protected.${extension}`;
}

export function ProtectTool({ focus = "pdf" }: { focus?: Focus }) {
  const { user } = useAuth();
  // Whether the Office options (Word, Excel, PowerPoint) are switched on (utils/features/plans.ts).
  const officeEnabled = isFeatureAvailable("protect.docx", getUserPlan(user));

  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [allowPrint, setAllowPrint] = useState(DEFAULT_PROTECT_OPTIONS.allowPrint);
  const [allowCopy, setAllowCopy] = useState(DEFAULT_PROTECT_OPTIONS.allowCopy);
  const [allowEdit, setAllowEdit] = useState(DEFAULT_PROTECT_OPTIONS.allowEdit);

  // The id and cancel handle of the run that is allowed to update the screen (0 = none).
  const currentOp = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const opCounter = useRef(0);

  useEffect(() => {
    return () => {
      // Leaving the page: stop any run and drop its result.
      currentOp.current = 0;
      controller.current?.abort();
      controller.current = null;
    };
  }, []);

  // Passwords do not outlive the run they were typed for.
  function clearPasswords() {
    setPassword("");
    setConfirm("");
    setFieldErrors({});
  }

  async function choose(file: File) {
    if (currentOp.current !== 0) return; // a run is in progress
    setError(null);
    setNotice(null);
    try {
      const { checkProtectFile } = await import("@/utils/protect/browser");
      const source = await checkProtectFile(file, officeEnabled);
      setStage({ name: "ready", file, kind: source === "pdf" || source === "image" ? source : "office" });
    } catch (err) {
      const code = toProtectError(err).code;
      void trackProtectFailed(code);
      setError(protectErrorMessage(code));
      setStage({ name: "idle" });
    }
  }

  async function run(file: File, kind: Kind) {
    if (currentOp.current !== 0) return; // one run at a time

    // Validate the form first: nothing starts, and nothing is cleared, if it is wrong.
    const errors: FieldErrors = {};
    const passwordCode = validatePassword(password);
    if (passwordCode) errors.password = protectErrorMessage(passwordCode);
    else {
      const confirmCode = confirm.length === 0 ? "protect_password_missing" : validatePassword(password, confirm);
      if (confirmCode) errors.confirm = confirmCode === "protect_password_missing" ? "Confirm your password." : protectErrorMessage(confirmCode);
    }
    setFieldErrors(errors);
    if (errors.password || errors.confirm) return;

    const op = ++opCounter.current;
    currentOp.current = op;
    const abort = new AbortController();
    controller.current = abort;
    const stillCurrent = () => currentOp.current === op;

    setError(null);
    setNotice(null);
    setStage({ name: "working", file, kind, phase: "validating", progress: 0 }); // also discards any earlier result
    const started = performance.now();
    void trackProtectStarted(kind === "office" ? (officeAppOf(file.name) ?? "office") : kind);
    try {
      const { protectFile } = await import("@/utils/protect/browser");
      const result = await protectFile(
        { file, password, options: { allowPrint, allowCopy, allowEdit }, officeEnabled },
        {
          signal: abort.signal,
          onPhase: (phase) => stillCurrent() && setStage((s) => (s.name === "working" ? { ...s, phase, progress: 0 } : s)),
          onProgress: (progress) => stillCurrent() && setStage((s) => (s.name === "working" ? { ...s, progress } : s)),
        },
      );
      if (!stillCurrent()) return; // superseded, cancelled or unmounted: discard the output
      const resultApp = result.extension === "pdf" ? null : OFFICE_TYPES[result.extension].app;
      void trackProtectCompleted(resultApp ?? kind, Math.round(performance.now() - started), kind === "office" ? undefined : { allowPrint, allowCopy, allowEdit });
      // Keep only a Blob (the browser can hold it outside the JavaScript heap); the verified bytes
      // are then dropped, so a large result is not held twice.
      const blob = new Blob([result.data as BlobPart], { type: result.mime });
      const noun = resultApp ? OFFICE_APP_NOUN[resultApp] : kind === "image" ? "picture" : "PDF";
      setStage({ name: "done", file, kind, blob, filename: outputFilename(file, kind, result.extension), noun, app: resultApp });
    } catch (err) {
      if (!stillCurrent()) return;
      const code = toProtectError(err).code;
      if (code === "protect_cancelled") setNotice(protectErrorMessage(code));
      else {
        void trackProtectFailed(code);
        setError(protectErrorMessage(code));
      }
      // The original stays selected and untouched; a run that already-protected or unreadable
      // files can't be retried goes back to picking a file.
      setStage(code === "protect_already_protected" || code === "protect_invalid" ? { name: "idle" } : { name: "ready", file, kind });
    } finally {
      if (stillCurrent()) {
        currentOp.current = 0;
        controller.current = null;
        clearPasswords();
      }
    }
  }

  function cancel() {
    controller.current?.abort();
  }

  function download(done: Extract<Stage, { name: "done" }>) {
    setError(null);
    try {
      downloadBlob(done.blob, done.filename);
      void trackDocumentDownloaded(done.app ?? "pdf");
    } catch {
      // The verified result is kept, so this can simply be tried again.
      setError("We couldn't start the download. Please try again.");
    }
  }

  function reset() {
    if (currentOp.current !== 0) return;
    clearPasswords();
    setError(null);
    setNotice(null);
    setStage({ name: "idle" });
  }

  const busy = stage.name === "working";
  const activeKind: Kind | null = stage.name === "idle" ? null : stage.kind;
  const isOffice = activeKind === "office";
  const activeFile = stage.name === "idle" || stage.name === "done" ? null : stage.file;
  const activeApp = activeFile ? officeAppOf(activeFile.name) : null; // null for an XML Document until it is converted
  const activeExtension: OfficeExtension | null = activeFile ? officeExtensionOf(activeFile.name) : null;
  const isXml = Boolean(activeFile?.name.toLowerCase().endsWith(".xml"));
  const noun = activeApp ? OFFICE_APP_NOUN[activeApp] : "document";
  const cta = isOffice ? `Protect ${activeApp ? noun : "document"}` : "Protect PDF";
  const leadApp = officeEnabled && focus !== "pdf" ? focus : null;

  return (
    <div className="space-y-4" data-clarity-mask="true">
      <p className="notice notice-info">
        <Icon name="shield" size={18} className="mt-0.5" />
        <span className="min-w-0 flex-1">
          <strong>No account needed.</strong> Your file and password stay on your device: the document is protected in your browser and is never uploaded.
        </span>
      </p>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {notice && (
        <p role="status" className="notice notice-info">
          {notice}
        </p>
      )}

      {stage.name === "idle" && (
        <FileDropzone
          accept={officeEnabled ? `application/pdf,.pdf,${OFFICE_ACCEPT},image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp` : "application/pdf,.pdf,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"}
          title={leadApp ? `Choose a ${OFFICE_APP_NOUN[leadApp]} to protect` : "Choose a file to protect"}
          hint={
            officeEnabled
              ? leadApp
                ? `or drop it here. ${APP_NAME[leadApp]} files${leadApp === "word" ? " (.docx, .docm, .dotx, .dotm)" : leadApp === "excel" ? " (.xlsx, .xlsm, .xltx, .xltm, .xlsb)" : " (.pptx, .pptm, .potx, .potm, .ppsx, .ppsm)"}, or an Office XML Document (.xml). You can also choose a PDF or a picture.`
                : "or drop it here. A PDF, a Word, Excel or PowerPoint file (.docx, .xlsx, .pptx and the macro-enabled and template versions), an Office XML Document (.xml), or a JPG, PNG or WebP picture (turned into a one-page PDF first)."
              : "or drop it here. You can also choose a JPG, PNG or WebP picture: it is turned into a one-page PDF first."
          }
          onFile={(file) => void choose(file)}
        />
      )}

      {stage.name !== "idle" && stage.name !== "done" && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (stage.name === "ready") void run(stage.file, stage.kind);
          }}
          noValidate
        >
          <div className="card flex flex-wrap items-center justify-between gap-2 p-3">
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{stage.file.name}</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{formatBytes(stage.file.size)}</p>
            <button type="button" onClick={reset} disabled={busy} className="btn btn-ghost min-h-11">
              Choose a different file
            </button>
          </div>

          <fieldset disabled={busy} className="space-y-4">
            <legend className="sr-only">Password and options</legend>
            <PasswordField
              label={isOffice ? "Password to open the document" : "Password to open the PDF"}
              value={password}
              onChange={(v) => {
                setPassword(v);
                if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
              }}
              autoComplete="new-password"
              error={fieldErrors.password}
              hint={`At least ${MIN_PASSWORD_LENGTH} characters. Longer is stronger.`}
            />
            <PasswordField
              label="Confirm password"
              value={confirm}
              onChange={(v) => {
                setConfirm(v);
                if (fieldErrors.confirm) setFieldErrors((f) => ({ ...f, confirm: undefined }));
              }}
              autoComplete="new-password"
              error={fieldErrors.confirm}
            />

            {isOffice ? (
              <div className="space-y-2">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {activeApp
                    ? `Your ${noun} will be encrypted and require this password to open in Microsoft ${APP_NAME[activeApp]}.`
                    : "Your file will be converted to a regular Office file, then encrypted and require this password to open in Microsoft Office."}
                </p>
                {isXml && (
                  <p className="notice notice-info !block">
                    This XML file will be converted to the regular Office file it describes (.docx, .xlsx or .pptx, depending on its content) before it is protected. Nothing in it is changed, but the
                    protected copy is that Office file, not an XML file.
                  </p>
                )}
                {activeExtension && OFFICE_TYPES[activeExtension].macro && (
                  <p className="notice notice-info !block">
                    This file can contain macros. They are not opened, changed or removed: the file is only encrypted. After you enter the password in {activeApp ? APP_NAME[activeApp] : "Office"}, it decides whether to
                    run them, as it would for the original.
                  </p>
                )}
              </div>
            ) : (
              <div className="card space-y-1 p-3">
                <p className="text-sm font-medium">What people who open it may do</p>
                <Option label="Print the document" checked={allowPrint} onChange={setAllowPrint} />
                <Option label="Copy text and images" checked={allowCopy} onChange={setAllowCopy} />
                <Option label="Edit or change it" checked={allowEdit} onChange={setAllowEdit} />
                <p className="pt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  These are requests that PDF apps honour, but they are not a lock: anyone with the password can still read the file, and a program that ignores the rules can
                  ignore them. The password is what keeps the file private.
                </p>
              </div>
            )}
          </fieldset>

          <div className="notice notice-warning !block">
            <strong>Don&apos;t forget this password.</strong> PDFScanner never sees it and cannot recover it. Keep it somewhere safe: if it is lost, the {isOffice ? "document" : "PDF"} cannot be opened.
          </div>

          {stage.name === "ready" ? (
            <div className="space-y-1">
              <button type="submit" className="btn btn-primary btn-lg w-full sm:w-auto">
                <Icon name="lock" size={18} /> {cta}
              </button>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Your original file is never changed. You download the protected copy separately.</p>
            </div>
          ) : (
            <div role="status" aria-live="polite" className="notice notice-info !block space-y-2">
              <p>{PHASE_LABEL[stage.phase]}</p>
              <progress className="block h-2 w-full" max={1} value={stage.progress} aria-label="Progress" />
              <button type="button" onClick={cancel} className="btn btn-secondary min-h-11">
                Cancel
              </button>
            </div>
          )}
        </form>
      )}

      {stage.name === "done" && (
        <div className="space-y-3">
          <div role="status" className="notice notice-success !block space-y-2 p-4">
            <p className="text-base font-semibold">Your {stage.noun} is protected</p>
            {stage.kind === "office" ? (
              <p>
                It is now an encrypted {stage.noun} ({stage.filename}, {formatBytes(stage.blob.size)}) that asks for your password when you open it in Microsoft {stage.app ? APP_NAME[stage.app] : "Office"}. We
                checked here that only your password opens it. Open it once to confirm, and keep the password somewhere safe.
              </p>
            ) : (
              <p>
                It now asks for your password before it opens ({stage.filename}, {formatBytes(stage.blob.size)}). It uses AES-256 encryption. Open it once to check the
                password works, and keep the password somewhere safe.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => download(stage)} className="btn btn-primary btn-lg">
              <Icon name="download" size={18} /> Download protected {stage.kind === "office" ? stage.noun : "PDF"}
            </button>
            <button type="button" onClick={reset} className="btn btn-secondary btn-lg">
              Protect another file
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Option({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 shrink-0 accent-blue-600" />
      <span>{label}</span>
    </label>
  );
}
