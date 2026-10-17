// Install guide + reminder logic, no browser needed.
//   node --no-warnings tests/install/unit.mjs
import assert from "node:assert/strict";
import { detect } from "../../utils/install/platform.ts";
import { BROWSERS_BY_OS, OS_OPTIONS, guideFor } from "../../utils/install/guides.ts";
import * as R from "../../utils/install/reminder.ts";

let pass = 0;
const ok = (name, fn) => {
  fn();
  pass++;
  console.log("  ok  " + name);
};

// ---- detection: real-world user agents -----------------------------------------------------------------
const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1",
  iphoneEdge: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/125.0.2535.60 Mobile/15E148 Safari/605.1.15",
  iphoneFirefox: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  ipadDesktopSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  samsung: "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  androidFirefox: "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0",
  androidEdge: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 EdgA/126.0.0.0",
  androidOpera: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 OPR/80.0.0.0",
  winChrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  winEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  winFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
  winOpera: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/111.0.0.0",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  linuxChrome: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
  unknown: "SomeBot/1.0",
  empty: "",
};
console.log("1. Device and browser detection");
const cases = [
  ["iPhone Safari", { userAgent: UA.iphoneSafari }, "ios", "safari"],
  ["iPhone Chrome", { userAgent: UA.iphoneChrome }, "ios", "chrome"],
  ["iPhone Edge", { userAgent: UA.iphoneEdge }, "ios", "edge"],
  ["iPhone Firefox", { userAgent: UA.iphoneFirefox }, "ios", "firefox"],
  ["iPad asking for the desktop site (reports a Mac, has touch)", { userAgent: UA.ipadDesktopSafari, platform: "MacIntel", maxTouchPoints: 5 }, "ios", "safari"],
  ["Android Chrome", { userAgent: UA.androidChrome }, "android", "chrome"],
  ["Samsung Internet (UA also says Chrome)", { userAgent: UA.samsung }, "android", "samsung"],
  ["Android Firefox", { userAgent: UA.androidFirefox }, "android", "firefox"],
  ["Android Edge", { userAgent: UA.androidEdge }, "android", "edge"],
  ["Android Opera is not mistaken for Chrome", { userAgent: UA.androidOpera }, "android", "other"],
  ["Windows Chrome", { userAgent: UA.winChrome }, "windows", "chrome"],
  ["Windows Edge (UA also says Chrome)", { userAgent: UA.winEdge }, "windows", "edge"],
  ["Windows Firefox", { userAgent: UA.winFirefox }, "windows", "firefox"],
  ["Windows Opera is not mistaken for Chrome", { userAgent: UA.winOpera }, "windows", "other"],
  ["macOS Safari (no touch)", { userAgent: UA.macSafari, platform: "MacIntel", maxTouchPoints: 0 }, "mac", "safari"],
  ["Mac user agent on a non-Apple touch device is not an iPad", { userAgent: UA.macSafari, platform: "Win32", maxTouchPoints: 10 }, "mac", "safari"],
  ["macOS Chrome", { userAgent: UA.macChrome, platform: "MacIntel", maxTouchPoints: 0 }, "mac", "chrome"],
  ["Linux Chrome", { userAgent: UA.linuxChrome }, "other", "chrome"],
  ["Linux Firefox", { userAgent: UA.linuxFirefox }, "other", "firefox"],
  ["unknown agent", { userAgent: UA.unknown }, "other", "other"],
  ["no user agent (server)", { userAgent: UA.empty }, "other", "other"],
];
for (const [name, env, os, browser] of cases) ok(name, () => assert.deepEqual(detect(env), { os, browser }));

console.log("2. Every device and browser the picker offers has usable, honest steps");
for (const o of OS_OPTIONS) {
  for (const b of BROWSERS_BY_OS[o.id]) {
    ok(`${o.id}/${b}`, () => {
      const g = guideFor(o.id, b);
      assert.ok(g.title && g.steps.length >= 3, "has steps");
      assert.ok(g.trouble.length >= 2, "has troubleshooting");
      assert.ok(/bookmark/i.test(g.trouble.join(" ") + g.steps.join(" ")), "offers a bookmark when the stated option is missing");
      assert.ok(g.steps.every((s) => s.length > 5 && !/offline/i.test(s)), "no offline claim in steps");
    });
  }
}
ok("detected combinations the picker cannot list still get a guide", () => {
  for (const [os, b] of [["other", "samsung"], ["windows", "safari"], ["mac", "samsung"]]) assert.ok(guideFor(os, b).steps.length >= 3);
});
ok("Safari on iPhone: Share, Add to Home Screen, Add", () => {
  const t = guideFor("ios", "safari").steps.join(" ");
  assert.ok(/Share/.test(t) && /Add to Home Screen/.test(t) && /Open as Web App/.test(t) && /Add in the top-right/.test(t));
});
ok("Chrome on iPhone: Share, Add to Home Screen", () => assert.ok(/Add to Home Screen/.test(guideFor("ios", "chrome").steps.join(" "))));
ok("Edge and Firefox on iPhone point to Safari as the sure option", () => {
  for (const b of ["edge", "firefox"]) assert.ok(/Safari/.test(guideFor("ios", b).steps.join(" ")));
});
ok("Android Chrome: Install app, with the shortcut-versus-install note", () => {
  const g = guideFor("android", "chrome");
  assert.ok(/Install app/.test(g.steps.join(" ")) && /shortcut/i.test(g.note));
});
ok("Windows Chrome and Edge use their real menu wording", () => {
  assert.ok(/Cast, save, and share/.test(guideFor("windows", "chrome").steps.join(" ")) && /Install page as app/.test(guideFor("windows", "chrome").steps.join(" ")));
  assert.ok(/Apps/.test(guideFor("windows", "edge").steps.join(" ")) && /Install this site as an app/.test(guideFor("windows", "edge").steps.join(" ")));
});
ok("Firefox on a computer is a bookmark, not a promise to install", () => {
  for (const os of ["windows", "mac"]) assert.equal(guideFor(os, "firefox").kind, "bookmark");
});
ok("Safari on Mac: Add to Dock and the macOS version needed", () => {
  const g = guideFor("mac", "safari");
  assert.ok(/Add to Dock/.test(g.steps.join(" ")) && /Sonoma/.test(g.note));
});

console.log("3. Reminder rules");
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
const ctx = (o = {}) => ({ now: NOW, standalone: false, cardVisible: false, installShownThisPage: false, helpShownThisPage: false, ...o });
ok("a fresh visitor may be shown the install card", () => assert.equal(R.mayShow("done", { v: 1 }, ctx()), true));
ok("never when already running as an installed app", () => assert.equal(R.mayShow("done", { v: 1 }, ctx({ standalone: true })), false));
ok("never while another card is up", () => assert.equal(R.mayShow("browse", { v: 1 }, ctx({ cardVisible: true })), false));
ok("one install card per page load, one help card per page load", () => {
  assert.equal(R.mayShow("done", { v: 1 }, ctx({ installShownThisPage: true })), false);
  assert.equal(R.mayShow("help", { v: 1 }, ctx({ helpShownThisPage: true })), false);
  assert.equal(R.mayShow("help", { v: 1 }, ctx({ installShownThisPage: true })), true);
});
ok("showing the card starts a minimum quiet period", () => {
  const s = R.afterAnswer({ v: 1 }, "shown", NOW);
  assert.equal(R.mayShow("done", s, ctx({ now: NOW + DAY - 1 })), false);
  assert.equal(R.mayShow("done", s, ctx({ now: NOW + DAY })), true);
});
ok("Maybe later is honoured for 14 days; Not yet for 3; close for 7", () => {
  for (const [a, d] of [["maybeLater", 14], ["notYet", 3], ["closed", 7]]) {
    const s = R.afterAnswer({ v: 1 }, a, NOW);
    assert.equal(R.mayShow("browse", s, ctx({ now: NOW + d * DAY - 1 })), false, a);
    assert.equal(R.mayShow("browse", s, ctx({ now: NOW + d * DAY })), true, a);
  }
});
ok("a shorter answer never shortens a longer quiet period", () => {
  const a = R.afterAnswer({ v: 1 }, "maybeLater", NOW);
  const b = R.afterAnswer(a, "notYet", NOW);
  assert.equal(b.quietUntil, a.quietUntil);
});
ok("Not yet does not count as turning the card down", () => assert.equal(R.afterAnswer({ v: 1 }, "notYet", NOW).dismissals, undefined));
ok("after three dismissals it stops", () => {
  let s = { v: 1 };
  for (let i = 0; i < 3; i++) s = R.afterAnswer(s, "closed", NOW - 365 * DAY);
  assert.equal(R.mayShow("done", s, ctx()), false);
});
ok("Don't remind me again and appinstalled switch the install card off for good, help stays available", () => {
  for (const a of ["never", "installed"]) {
    const s = R.afterAnswer({ v: 1 }, a, NOW);
    assert.equal(R.mayShow("done", s, ctx({ now: NOW + 3650 * DAY })), false);
    assert.equal(R.mayShow("browse", s, ctx({ now: NOW + 3650 * DAY })), false);
    assert.equal(R.mayShow("help", s, ctx()), true);
  }
});
ok("help has its own quiet period and dismissal limit, independent of the install card", () => {
  let s = R.afterHelp({ v: 1 }, "dismissed", NOW);
  assert.equal(R.mayShow("help", s, ctx({ now: NOW + 3 * DAY - 1 })), false);
  assert.equal(R.mayShow("help", s, ctx({ now: NOW + 3 * DAY })), true);
  assert.equal(R.mayShow("done", s, ctx()), true);
  for (let i = 0; i < 3; i++) s = R.afterHelp(s, "dismissed", NOW - 365 * DAY);
  assert.equal(R.mayShow("help", s, ctx()), false);
});
ok("state survives a round trip, and bad or missing storage means defaults", () => {
  const mem = new Map();
  const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
  const s = R.afterAnswer({ v: 1 }, "maybeLater", NOW);
  assert.equal(R.writeState(st, s), true);
  assert.deepEqual(R.readState(st), s);
  mem.set(R.REMINDER_KEY, "{not json");
  assert.deepEqual(R.readState(st), { v: 1 });
  mem.set(R.REMINDER_KEY, JSON.stringify({ off: "yes", quietUntil: "soon", dismissals: -4 }));
  assert.deepEqual(R.readState(st), { v: 1 });
  assert.deepEqual(R.readState(null), { v: 1 });
  assert.equal(R.writeState(null, s), false);
  assert.equal(R.writeState({ getItem: () => null, setItem: () => { throw new Error("quota"); } }, s), false);
});

console.log("4. The three signals");
const act = (o) => ({ ...R.newActivity(), ...o });
ok("nothing on arrival or after one scroll", () => {
  assert.equal(R.browsingEngaged(act({ activeMs: 0 })), false);
  assert.equal(R.browsingEngaged(act({ activeMs: 5000 })), false);
});
ok("a minute of real interaction counts as meaningful browsing", () => {
  assert.equal(R.browsingEngaged(act({ activeMs: 59_000 })), false);
  assert.equal(R.browsingEngaged(act({ activeMs: 60_000 })), true);
});
ok("three pages plus a little time counts; three pages alone does not", () => {
  assert.equal(R.browsingEngaged(act({ pages: 3, activeMs: 10_000 })), false);
  assert.equal(R.browsingEngaged(act({ pages: 3, activeMs: 20_000 })), true);
  assert.equal(R.browsingEngaged(act({ pages: 2, activeMs: 20_000 })), false);
});
ok("browsing never fires once a file was chosen or saved", () => {
  assert.equal(R.browsingEngaged(act({ activeMs: 600_000, taskStarted: true })), false);
  assert.equal(R.browsingEngaged(act({ activeMs: 600_000, taskCompleted: true })), false);
});
ok("help only for a started, unsaved task after a quiet spell; quiet alone is not enough", () => {
  assert.equal(R.unfinishedDue(act({ idleMs: 600_000 })), false);
  assert.equal(R.unfinishedDue(act({ taskStarted: true, idleMs: 89_000 })), false);
  assert.equal(R.unfinishedDue(act({ taskStarted: true, idleMs: 90_000 })), true);
  assert.equal(R.unfinishedDue(act({ taskStarted: true, taskCompleted: true, idleMs: 600_000 })), false);
});
ok("calm moment: not hidden, no dialog, not typing", () => {
  assert.equal(R.readyToShow({ hidden: false, dialogOpen: false, typing: false }), true);
  for (const k of ["hidden", "dialogOpen", "typing"]) assert.equal(R.readyToShow({ hidden: false, dialogOpen: false, typing: false, [k]: true }), false, k);
});
ok("exit intent: only a mouse leaving through the top; never on touch devices", () => {
  assert.equal(R.isExitIntent({ clientY: -2, relatedTarget: null }, true), true);
  assert.equal(R.isExitIntent({ clientY: 300, relatedTarget: null }, true), false);
  assert.equal(R.isExitIntent({ clientY: -2, relatedTarget: {} }, true), false);
  assert.equal(R.isExitIntent({ clientY: -2, relatedTarget: null }, false), false);
});

console.log(`\n${pass} checks passed`);
