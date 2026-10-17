// The install guide's content: which devices and browsers it covers and the steps for each. Plain data, so
// the wording is reviewed in one place and the tests can check every combination has steps.
//
// Written from the vendors' own pages (kept in GUIDE_SOURCES). Browsers move menu items between releases,
// so every guide says what to look for and ends with a fallback that always works (a bookmark).
// Only claims we can stand behind: there is no service worker, so nothing here promises offline use.

import type { BrowserId, OsId } from "./platform";

export interface OsOption {
  id: OsId;
  label: string;
}

export const OS_OPTIONS: OsOption[] = [
  { id: "ios", label: "iPhone or iPad" },
  { id: "android", label: "Android phone or tablet" },
  { id: "windows", label: "Windows computer" },
  { id: "mac", label: "Mac" },
  { id: "other", label: "Other device" },
];

export const BROWSER_LABEL: Record<BrowserId, string> = {
  safari: "Safari",
  chrome: "Chrome",
  edge: "Microsoft Edge",
  firefox: "Firefox",
  samsung: "Samsung Internet",
  other: "Another browser",
};

// Browsers offered after the device is chosen, in the order people most likely use them.
export const BROWSERS_BY_OS: Record<OsId, BrowserId[]> = {
  ios: ["safari", "chrome", "edge", "firefox", "other"],
  android: ["chrome", "samsung", "edge", "firefox", "other"],
  windows: ["chrome", "edge", "firefox", "other"],
  mac: ["safari", "chrome", "edge", "firefox", "other"],
  other: ["chrome", "edge", "firefox", "other"],
};

export interface Guide {
  title: string;
  // "native" = this browser can show its own install prompt (the button offers it when the browser has one ready).
  kind: "install" | "shortcut" | "bookmark";
  steps: string[];
  note?: string;
  // Shown under "I can't find it".
  trouble: string[];
}

const BOOKMARK_STEPS = [
  "Open the browser's menu.",
  "Choose Bookmark this page (or press Ctrl+D, or Cmd+D on a Mac).",
  "Save it to the bookmarks bar, so FreePDFScanner is one click away.",
];

const GENERIC_TROUBLE = [
  "Make sure you are on freepdfscanner.com itself, not inside another app's built-in browser. Open the page in your normal browser.",
  "Update the browser to its latest version; older ones do not have the option.",
  "You can always bookmark the page instead.",
];

const HOME_SCREEN_NOTE = "This adds a shortcut icon. FreePDFScanner still needs an internet connection; it does not work offline.";

export function guideFor(os: OsId, browser: BrowserId): Guide {
  if (os === "ios") {
    if (browser === "safari") {
      return {
        title: "Add to your Home Screen in Safari",
        kind: "install",
        steps: [
          "Tap the Share button (a square with an arrow pointing up) in Safari's toolbar. On iPad it is at the top; on iPhone it is at the bottom, or behind the three dots.",
          "Scroll down and tap Add to Home Screen. If you do not see it, scroll to the bottom of the list and tap Edit Actions, then add it.",
          "If you are offered Open as Web App, leave it switched on.",
          "Tap Add in the top-right corner.",
        ],
        note: HOME_SCREEN_NOTE,
        trouble: [
          "Add to Home Screen only appears in Safari's Share menu, or in Chrome, Edge and Firefox on iOS 16.4 or later. Open freepdfscanner.com in Safari if it is missing.",
          "If the Share button is missing, tap the page once or scroll up slightly to bring the toolbar back.",
          ...GENERIC_TROUBLE.slice(1),
        ],
      };
    }
    if (browser === "chrome") {
      return {
        title: "Add to your Home Screen in Chrome",
        kind: "install",
        steps: [
          "Tap the Share button in Chrome's address bar (a square with an arrow pointing up). If you do not see it, open the three-dot menu and tap Share.",
          "Tap Add to Home Screen.",
          "Tap Add.",
        ],
        note: HOME_SCREEN_NOTE,
        trouble: [
          "Chrome on iPhone and iPad only has this option on iOS 16.4 or later. On older versions, open freepdfscanner.com in Safari instead.",
          ...GENERIC_TROUBLE,
        ],
      };
    }
    const name = BROWSER_LABEL[browser];
    return {
      title: `Add to your Home Screen from ${name}`,
      kind: "install",
      steps: [
        `Open the ${name} menu and tap Share.`,
        "Look for Add to Home Screen in the list that appears. If it is there, tap it, then tap Add.",
        "If it is not there, open freepdfscanner.com in Safari and follow the Safari steps. Safari always has it.",
      ],
      note: "Not every iPhone browser can add a Home Screen shortcut. We have not been able to confirm the exact steps for this one, so Safari is the reliable choice.",
      trouble: GENERIC_TROUBLE,
    };
  }

  if (os === "android") {
    if (browser === "chrome") {
      return {
        title: "Install in Chrome on Android",
        kind: "install",
        steps: [
          "Tap the three-dot menu at the top-right of Chrome.",
          "Tap Install app. If you see Add to Home screen instead, tap that and then Install.",
          "Confirm by tapping Install, and the icon is placed on your Home screen or in your app list.",
        ],
        note: "Some versions only offer Add to Home screen, which creates a shortcut that opens in Chrome; Install app opens FreePDFScanner in its own window. Both put it one tap away.",
        trouble: [
          "Chrome shows Install app only on pages it considers installable. Reload the page, use it for a moment, and look again.",
          "If it is already installed, the menu shows Open instead.",
          ...GENERIC_TROUBLE.slice(1),
        ],
      };
    }
    if (browser === "samsung") {
      return {
        title: "Add to your Home screen in Samsung Internet",
        kind: "shortcut",
        steps: [
          "Tap the menu button (three lines) at the bottom-right.",
          "Tap Add page to, then Home screen. If you see an Install icon in the address bar, you can tap that instead.",
          "Tap Add.",
        ],
        note: HOME_SCREEN_NOTE,
        trouble: GENERIC_TROUBLE,
      };
    }
    if (browser === "edge") {
      return {
        title: "Install in Edge on Android",
        kind: "install",
        steps: [
          "Tap the three-dot menu at the bottom of Edge.",
          "Tap Add to phone (it may be under Add to).",
          "Tap Add or Install to confirm.",
        ],
        trouble: GENERIC_TROUBLE,
      };
    }
    if (browser === "firefox") {
      return {
        title: "Add to your Home screen in Firefox",
        kind: "shortcut",
        steps: ["Tap the three-dot menu in Firefox.", "Tap Install (some versions say Add to Home screen).", "Tap Add."],
        note: HOME_SCREEN_NOTE,
        trouble: GENERIC_TROUBLE,
      };
    }
    return {
      title: "Add a shortcut to your Home screen",
      kind: "shortcut",
      steps: [
        "Open your browser's menu (usually three dots or three lines).",
        "Look for Add to Home screen, Install app or Add page to.",
        "Confirm by tapping Add. If your browser has none of these, bookmark the page instead.",
      ],
      note: "We do not have exact steps for every Android browser. Chrome always has the option.",
      trouble: GENERIC_TROUBLE,
    };
  }

  if (os === "windows") {
    if (browser === "chrome") {
      return {
        title: "Install in Chrome on Windows",
        kind: "install",
        steps: [
          "Look at the right end of the address bar for an Install icon (a small screen with a down arrow). If you see it, click it and choose Install.",
          "If there is no icon, click the three-dot menu, then Cast, save, and share, then Install page as app.",
          "Click Install. FreePDFScanner opens in its own window and can be pinned to the taskbar or Start menu.",
        ],
        trouble: [
          "In older Chrome versions the item is under the three-dot menu, then Save and share (or More tools), then Create shortcut. Tick Open as window.",
          ...GENERIC_TROUBLE,
        ],
      };
    }
    if (browser === "edge") {
      return {
        title: "Install in Microsoft Edge",
        kind: "install",
        steps: [
          "Click the three-dot menu (Settings and more) at the top-right.",
          "Choose Apps, then Install this site as an app.",
          "Click Install. You can then choose to pin it to the taskbar or Start menu.",
        ],
        trouble: ["An App available icon may also appear in the address bar. Click it to install.", ...GENERIC_TROUBLE],
      };
    }
    if (browser === "firefox") {
      return {
        title: "Keep FreePDFScanner close in Firefox",
        kind: "bookmark",
        steps: BOOKMARK_STEPS,
        note: "Firefox on Windows does not install websites as apps. A bookmark is the dependable way; for a desktop shortcut, Chrome and Edge can install it as an app.",
        trouble: GENERIC_TROUBLE,
      };
    }
  }

  if (os === "mac") {
    if (browser === "safari") {
      return {
        title: "Add to your Dock in Safari",
        kind: "install",
        steps: [
          "In the menu bar, click File.",
          "Choose Add to Dock.",
          "Check the name and click Add. FreePDFScanner now opens from the Dock like an app.",
        ],
        note: "Add to Dock needs macOS Sonoma (14) or later with Safari 17 or later.",
        trouble: [
          "If File has no Add to Dock, your Mac or Safari is older. Bookmark the page instead: press Cmd+D.",
          ...GENERIC_TROUBLE,
        ],
      };
    }
    if (browser === "chrome") {
      return {
        title: "Install in Chrome on Mac",
        kind: "install",
        steps: [
          "Look at the right end of the address bar for an Install icon. If you see it, click it and choose Install.",
          "If there is no icon, open the three-dot menu, then Cast, save, and share, then Install page as app.",
          "Click Install. FreePDFScanner opens in its own window and can be kept in the Dock.",
        ],
        trouble: GENERIC_TROUBLE,
      };
    }
    if (browser === "edge") {
      return {
        title: "Install in Microsoft Edge",
        kind: "install",
        steps: [
          "Click the three-dot menu (Settings and more) at the top-right.",
          "Choose Apps, then Install this site as an app.",
          "Click Install.",
        ],
        trouble: GENERIC_TROUBLE,
      };
    }
    if (browser === "firefox") {
      return {
        title: "Keep FreePDFScanner close in Firefox",
        kind: "bookmark",
        steps: BOOKMARK_STEPS,
        note: "Firefox on Mac does not install websites as apps. Safari (macOS Sonoma or later), Chrome and Edge can.",
        trouble: GENERIC_TROUBLE,
      };
    }
  }

  if (os === "other" && (browser === "chrome" || browser === "edge")) {
    const name = browser === "edge" ? "Microsoft Edge" : "Chrome";
    return {
      title: `Install in ${name}`,
      kind: "install",
      steps: [
        "Look at the right end of the address bar for an Install icon. If you see it, click it and choose Install.",
        browser === "edge"
          ? "If there is no icon, open the three-dot menu, then Apps, then Install this site as an app."
          : "If there is no icon, open the three-dot menu, then Cast, save, and share, then Install page as app.",
        "Click Install.",
      ],
      trouble: GENERIC_TROUBLE,
    };
  }

  return {
    title: "Keep FreePDFScanner close",
    kind: "bookmark",
    steps: BOOKMARK_STEPS,
    note: "We do not have confirmed install steps for this device and browser, so a bookmark is the safest option. Chrome and Edge can install it as an app on most computers.",
    trouble: GENERIC_TROUBLE,
  };
}

export const GUIDE_SOURCES = [
  { label: "Apple: add a website to your iPhone Home Screen", href: "https://support.apple.com/guide/iphone/bookmark-favorite-webpages-iph42ab2f3a7/ios" },
  { label: "Google: install a website as an app in Chrome", href: "https://support.google.com/chrome/answer/9658361" },
  { label: "Microsoft: install a site as an app in Edge", href: "https://learn.microsoft.com/microsoft-edge/progressive-web-apps/ux" },
  { label: "Apple: add a website to the Dock in Safari", href: "https://support.apple.com/guide/safari/add-a-website-to-the-dock-ibrw1049/mac" },
  { label: "MDN: making PWAs installable", href: "https://developer.mozilla.org/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable" },
];
