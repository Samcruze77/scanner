// Holds the browser's own install prompt (Chrome, Edge and other Chromium browsers fire
// `beforeinstallprompt`) until the visitor clicks "Add FreePDFScanner". The prompt is deferred, never shown on
// its own, and only ever opened from a click handler. Safari, Firefox and iOS never fire the event, so for them
// `canPrompt()` stays false and the guide's manual steps are shown instead.
//
// "Installed" is only claimed after the browser's own `appinstalled` event; a click on the prompt's Install
// button is not proof (the person can still cancel the operating system's dialog).

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
let started = false;

function emit() {
  for (const l of listeners) l();
}

export function startCapturingInstallPrompt(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep the browser's mini-infobar quiet; we offer it from our own button
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    emit();
  });
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const canPrompt = (): boolean => deferred !== null;
export const wasInstalled = (): boolean => installed;

export type PromptResult = "accepted" | "dismissed" | "unavailable";

// Must be called from a user's click. The saved event can be used once.
export async function promptInstall(): Promise<PromptResult> {
  const event = deferred;
  if (!event) return "unavailable";
  deferred = null;
  emit();
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome;
  } catch {
    return "unavailable";
  }
}
