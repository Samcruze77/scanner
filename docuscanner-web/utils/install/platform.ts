// Works out which device and browser a visitor is on, so the install guide can open on the right steps.
// Detection only picks the starting point: the guide always lets the person choose another device or
// browser, because user-agent strings lie (iPadOS reports a Mac, in-app browsers copy Chrome, ...).
// Pure functions of the values passed in, so every case is unit-tested without a browser.

export type OsId = "ios" | "android" | "windows" | "mac" | "other";
export type BrowserId = "safari" | "chrome" | "edge" | "firefox" | "samsung" | "other";

export interface Environment {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}

export interface Detected {
  os: OsId;
  browser: BrowserId;
}

export function detectOs(env: Environment): OsId {
  const ua = env.userAgent;
  if (/iPhone|iPod|iPad/.test(ua)) return "ios";
  // iPadOS 13+ asks for the desktop site by default and says "Macintosh"; only a touch screen gives it away.
  if (/Macintosh/.test(ua) && (env.platform === undefined || env.platform === "MacIntel") && (env.maxTouchPoints ?? 0) > 1) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Windows/.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/.test(ua)) return "mac";
  return "other";
}

export function detectBrowser(env: Environment, os: OsId): BrowserId {
  const ua = env.userAgent;
  if (os === "ios") {
    // Every iPhone/iPad browser is built on Safari's engine; the marker says which one the person opened.
    if (/EdgiOS/.test(ua)) return "edge";
    if (/FxiOS/.test(ua)) return "firefox";
    if (/CriOS/.test(ua)) return "chrome";
    if (/OPiOS|OPT\/|DuckDuckGo|GSA\/|YaBrowser|Brave/.test(ua)) return "other";
    return /Safari|Version\//.test(ua) || /Macintosh/.test(ua) ? "safari" : "other";
  }
  if (/SamsungBrowser/.test(ua)) return "samsung";
  if (/Edg(e|A|iOS)?\//.test(ua)) return "edge";
  if (/Firefox\/|Fennec/.test(ua)) return "firefox";
  if (/OPR\/|Opera|UCBrowser|YaBrowser|DuckDuckGo|Vivaldi|Whale|MiuiBrowser|HuaweiBrowser/.test(ua)) return "other";
  if (/Chrome\/|Chromium\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua)) return "safari";
  return "other";
}

export function detect(env: Environment): Detected {
  const os = detectOs(env);
  return { os, browser: detectBrowser(env, os) };
}

export function currentEnvironment(): Environment {
  if (typeof navigator === "undefined") return { userAgent: "" };
  return { userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints };
}

// True when the site is already running as an installed app (standalone window or iOS home-screen app).
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.matchMedia("(display-mode: standalone)").matches) return true;
    if (window.matchMedia("(display-mode: minimal-ui)").matches) return true;
  } catch {
    // matchMedia unavailable: fall through to the iOS flag.
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
