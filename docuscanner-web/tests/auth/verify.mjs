// End-to-end check of the authentication UX (log in, sign up, show/hide password,
// forgot password, the reset page) in a real browser, driven over the DevTools
// protocol against a running app.
//
// Supabase's auth endpoints are answered by a mock installed in the page, so the
// run is deterministic, sends no real email and creates no real account, and it
// can inspect exactly what the app sends. One separate check talks to the REAL
// project's recovery endpoint with an address that doesn't exist, to confirm the
// server answers the same way whoever the address belongs to.
//
// Needs the app running (npm run build && npm run start). Run:
//   node tests/auth/verify.mjs [baseUrl]            (default http://localhost:3000)
// SKIP_REAL=1 skips the one real-server check. CHROME picks the browser.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const BASE = process.argv[2] ?? "http://localhost:3000";
const work = fs.mkdtempSync(path.join(os.tmpdir(), "auth-verify-"));
const outDir = path.join(here, "out");
fs.mkdirSync(outDir, { recursive: true });

function readEnv() {
  const env = {};
  for (const file of [".env.local", ".env"]) {
    const p = path.join(root, file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in env)) env[m[1]] = m[2].trim();
    }
  }
  return env;
}
const ENV = readEnv();
const SUPABASE_URL = ENV.NEXT_PUBLIC_SUPABASE_URL;
if (!SUPABASE_URL) throw new Error("NEXT_PUBLIC_SUPABASE_URL not found in .env.local");

const CHROME = [process.env.CHROME, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && fs.existsSync(p));
if (!CHROME) throw new Error("No Chrome/Edge found. Set CHROME to a browser executable.");

// Every password typed anywhere in this run. None of them may appear in the console,
// analytics, addresses or storage afterwards.
const PW = {
  ok: "Correct-Horse-9",
  wrong: "Wr0ng-Guess-77",
  signup: "Sign-Up-Secret-31",
  fresh: "New-Secret-Pass-42",
  same: "Same-As-Before-1",
  weak: "Weak-Password-1",
  lost: "LostSession-1",
  short: "abc123",
  mismatchA: "Mismatch-Aaaa-11",
  mismatchB: "Mismatch-Bbbb-22",
};

// ---- the in-page mock of Supabase Auth ----------------------------------------------------------

const MOCK = `
(() => {
  const AUTH = ${JSON.stringify(SUPABASE_URL + "/auth/v1")};
  window.__events = [];
  window.__authCalls = [];
  const realFetch = window.fetch.bind(window);
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\\+/g, '-').replace(/\\//g, '_');
  const now = () => Math.floor(Date.now() / 1000);
  const user = (email) => ({ id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: '2024-01-01T00:00:00Z', app_metadata: { provider: 'email' }, user_metadata: {}, identities: [], created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' });
  const session = (email) => {
    const exp = now() + 3600;
    const token = [b64({ alg: 'none', typ: 'JWT' }), b64({ aud: 'authenticated', exp, sub: '00000000-0000-4000-8000-000000000001', email, role: 'authenticated' }), 'x'].join('.');
    return { access_token: token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'mock-refresh-token', user: user(email) };
  };
  const json = (status, body) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const err = (status, code, msg) => json(status, { code: status, error_code: code, msg });
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('track-analytics')) {
      try { window.__events.push(JSON.parse(init.body)); } catch {}
      return realFetch(input, init);
    }
    if (!url.startsWith(AUTH)) return realFetch(input, init);
    const path = url.slice(AUTH.length);
    const method = ((init && init.method) || 'GET').toUpperCase();
    let body = null;
    try { body = init && init.body ? JSON.parse(init.body) : null; } catch {}
    window.__authCalls.push({ method, path, body });
    await new Promise((r) => setTimeout(r, 60));
    if (method === 'POST' && path.startsWith('/token?grant_type=password')) {
      if (body.email === 'user@example.com' && body.password === ${JSON.stringify(PW.ok)}) return json(200, session(body.email));
      if (body.email === 'unconfirmed@example.com') return err(400, 'email_not_confirmed', 'Email not confirmed');
      return err(400, 'invalid_credentials', 'Invalid login credentials');
    }
    if (method === 'POST' && path.startsWith('/signup')) {
      if (body.email === 'taken@example.com') return err(422, 'user_already_exists', 'User already registered');
      return json(200, user(body.email));
    }
    if (method === 'POST' && path.startsWith('/recover')) {
      if (body.email === 'ratelimit@example.com') return err(429, 'over_email_send_rate_limit', 'Email rate limit exceeded');
      if (body.email === 'broken@example.com') return err(500, 'unexpected_failure', 'Internal error');
      if (body.email === 'invalid@example.com') return err(400, 'email_address_invalid', 'Email address is invalid');
      return json(200, {});
    }
    if (method === 'POST' && path.startsWith('/token?grant_type=pkce')) {
      if (body.auth_code === 'goodcode') return json(200, session('user@example.com'));
      return err(400, 'flow_state_expired', 'invalid flow state, flow state has expired');
    }
    if (method === 'PUT' && path.startsWith('/user')) {
      if (body.password === ${JSON.stringify(PW.same)}) return err(422, 'same_password', 'New password should be different from the old password.');
      if (body.password === ${JSON.stringify(PW.weak)}) return err(422, 'weak_password', 'Password is known to be weak and easy to guess, please choose a different one.');
      if (body.password === ${JSON.stringify(PW.lost)}) return err(401, 'session_not_found', 'Session not found');
      return json(200, user('user@example.com'));
    }
    if (method === 'GET' && path.startsWith('/user')) return json(200, user('user@example.com'));
    if (method === 'POST' && path.startsWith('/logout')) return new Response(null, { status: 204 });
    return err(404, 'not_mocked', 'not mocked: ' + path);
  };
})();
`;

// ---- CDP ---------------------------------------------------------------------------------------

const port = 9200 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(work, "profile")}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
process.on("exit", () => chrome.kill());
async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("browser did not start");
}
const ws = new WebSocket(await connect());
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
const consoleText = []; // everything the page printed, of any kind
const visitedUrls = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else if (msg.method === "Runtime.exceptionThrown") consoleText.push(`exception: ${JSON.stringify(msg.params.exceptionDetails)}`);
  else if (msg.method === "Runtime.consoleAPICalled") consoleText.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
  else if (msg.method === "Log.entryAdded") consoleText.push(`log ${msg.params.entry.level}: ${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
  else if (msg.method === "Page.frameNavigated" && !msg.params.frame.parentId) visitedUrls.push(msg.params.frame.url);
  else if (msg.method === "Page.navigatedWithinDocument") visitedUrls.push(msg.params.url);
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expression, what, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await sleep(120);
  }
  throw new Error(`timed out waiting for ${what}`);
}
await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Network.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: MOCK });

// ---- helpers -----------------------------------------------------------------------------------

async function open(route, { width = 1280, height = 900, mobile = false, referrer, keep = false } = {}) {
  if (!keep) {
    await send("Network.clearBrowserCookies");
    await evaluate("try { localStorage.clear(); sessionStorage.clear(); } catch {}").catch(() => undefined);
  }
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
  await send("Page.navigate", { url: "about:blank" });
  await sleep(150);
  await send("Page.navigate", { url: BASE + route, referrer });
  await waitFor(`document.readyState === 'complete' && document.querySelector('main')`, route);
  await sleep(500);
}
const calls = () => evaluate("window.__authCalls");
const callsTo = async (method, prefix) => (await calls()).filter((c) => c.method === method && c.path.startsWith(prefix));
const dialog = `document.querySelector('[role=dialog]')`;
const byText = (scope, selector, text) => `[...${scope}.querySelectorAll('${selector}')].find(b => b.innerText.trim() === ${JSON.stringify(text)})`;
const click = (expr) => evaluate(`(() => { const b = ${expr}; if (!b) throw new Error('missing element: ' + ${JSON.stringify(expr.slice(0, 90))}); b.click(); return true; })()`);
async function realClick(expr) {
  const r = await evaluate(`(() => { const b = ${expr}; if (!b) throw new Error('missing'); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", buttons: 1, clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await sleep(120);
}
async function type(selector, text) {
  await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.select && el.select(); })()`);
  await send("Input.insertText", { text });
  await sleep(40);
}
const field = (label) => `[...document.querySelectorAll('[role=dialog] label, main label')].find(l => l.innerText.trim() === ${JSON.stringify(label)})`;
const inputFor = (label) => `document.getElementById(${field(label)}.htmlFor)`;
const typeInto = async (label, text) => {
  const id = await evaluate(`${field(label)}.htmlFor`);
  await type(`[id="${id}"]`, text);
};
async function openLogin() {
  await click(byText("document", "header button", "Log in"));
  await waitFor(dialog, "the log-in dialog");
}
const modalTitle = () => evaluate(`${dialog}.querySelector('h2').innerText`);
const alerts = () => evaluate(`[...document.querySelectorAll('[role=alert]')].map(a => a.innerText.trim())`);

let passed = 0;
let failed = 0;
async function test(name, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return;
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${e.message.split("\n").slice(0, 16).join("\n      ")}`);
  }
}
const log = (s) => console.log(`      ${s}`);

console.log(`Authentication UX verification against ${BASE} using ${path.basename(CHROME)}`);

// ================================================================================================
console.log("Show / hide password");

await test("the password is masked by default, with an eye button that is a 44px target and never submits the form", async () => {
  await open("/");
  await openLogin();
  await typeInto("Password", PW.ok);
  const s = await evaluate(`(() => { const i = ${inputFor("Password")}; const b = ${dialog}.querySelector('button[aria-label="Show password"]'); const r = b.getBoundingClientRect(); return { type: i.type, hasButton: !!b, w: r.width, h: r.height, btnType: b.type }; })()`);
  assert.equal(s.type, "password", "masked by default");
  assert.equal(s.btnType, "button", "the eye is type=button");
  assert.ok(s.w >= 44 && s.h >= 44, `touch target ${s.w}x${s.h}`);
  // Press it with the fields otherwise empty/invalid: a submit would show validation errors and call the server.
  await evaluate(`${inputFor("Email")}.value = ''`);
  await realClick(`${dialog}.querySelector('button[aria-label="Show password"]')`);
  await realClick(`${dialog}.querySelector('button[aria-label="Hide password"]')`);
  assert.deepEqual(await alerts(), [], "no validation message: the form was not submitted");
  assert.equal((await calls()).length, 0, "no request was made");
  assert.equal(await modalTitle(), "Log in");
});

await test("clicking the eye reveals the password, clicking again masks it, and the value is never changed", async () => {
  const read = () => evaluate(`(() => { const i = ${inputFor("Password")}; return { type: i.type, value: i.value, label: ${dialog}.querySelector('button[aria-controls="' + i.id + '"]').getAttribute('aria-label') }; })()`);
  let s = await read();
  assert.deepEqual(s, { type: "password", value: PW.ok, label: "Show password" });
  await realClick(`${dialog}.querySelector('button[aria-label="Show password"]')`);
  s = await read();
  assert.deepEqual(s, { type: "text", value: PW.ok, label: "Hide password" });
  await realClick(`${dialog}.querySelector('button[aria-label="Hide password"]')`);
  s = await read();
  assert.deepEqual(s, { type: "password", value: PW.ok, label: "Show password" });
  // Several rounds: it always ends masked when toggled off.
  for (let i = 0; i < 4; i++) await realClick(`${dialog}.querySelector('button[aria-controls]')`);
  s = await read();
  assert.equal(s.type, "password");
  assert.equal(s.value, PW.ok);
});

await test("the caret and focus stay where they were when the eye is pressed", async () => {
  await evaluate(`(() => { const i = ${inputFor("Password")}; i.focus(); i.setSelectionRange(4, 4); })()`);
  await realClick(`${dialog}.querySelector('button[aria-controls]')`);
  let s = await evaluate(`(() => { const i = ${inputFor("Password")}; return { focused: document.activeElement === i, start: i.selectionStart, end: i.selectionEnd, type: i.type }; })()`);
  assert.deepEqual(s, { focused: true, start: 4, end: 4, type: "text" });
  await evaluate(`${inputFor("Password")}.setSelectionRange(2, 7)`);
  await realClick(`${dialog}.querySelector('button[aria-controls]')`);
  s = await evaluate(`(() => { const i = ${inputFor("Password")}; return { focused: document.activeElement === i, start: i.selectionStart, end: i.selectionEnd, type: i.type }; })()`);
  assert.deepEqual(s, { focused: true, start: 2, end: 7, type: "password" });
  // Typing continues at the caret.
  await evaluate(`${inputFor("Password")}.setSelectionRange(2, 2)`);
  await send("Input.insertText", { text: "ZZ" });
  const v = await evaluate(`${inputFor("Password")}.value`);
  assert.equal(v, PW.ok.slice(0, 2) + "ZZ" + PW.ok.slice(2));
});

await test("sign-up has a confirm field: both masked, each with its own independent eye, and consistent validation", async () => {
  await open("/");
  await click(byText("document", "header button", "Sign up free"));
  await waitFor(`${dialog}`, "sign-up dialog");
  assert.equal(await modalTitle(), "Create your free account");
  const s = await evaluate(`(() => { const d = ${dialog}; const inputs = [...d.querySelectorAll('input[autocomplete="new-password"]')]; return { count: inputs.length, types: inputs.map(i => i.type), buttons: [...d.querySelectorAll('button[aria-controls]')].map(b => b.getAttribute('aria-label')) }; })()`);
  assert.deepEqual(s, { count: 2, types: ["password", "password"], buttons: ["Show password", "Show confirm password"] });
  await typeInto("Password", PW.signup);
  await typeInto("Confirm password", PW.signup);
  await realClick(`${dialog}.querySelector('button[aria-label="Show confirm password"]')`);
  const t = await evaluate(`[...${dialog}.querySelectorAll('input[autocomplete="new-password"]')].map(i => i.type)`);
  assert.deepEqual(t, ["password", "text"], "toggling one field doesn't reveal the other");
  await realClick(`${dialog}.querySelector('button[aria-label="Hide confirm password"]')`);
});

// ================================================================================================
console.log("Password rules (one set, everywhere)");

await test("sign-up: empty, too short, and mismatching passwords each get a clear message and no request", async () => {
  await open("/");
  await click(byText("document", "header button", "Sign up free"));
  await waitFor(dialog, "dialog");
  await typeInto("Email", "new@example.com");
  await click(byText(dialog, "button[type=submit]", "Sign up"));
  let a = await alerts();
  assert.deepEqual(a, ["Enter a password.", "Type your password again to confirm it."]);
  await typeInto("Password", PW.short);
  await typeInto("Confirm password", PW.short);
  await click(byText(dialog, "button[type=submit]", "Sign up"));
  a = await alerts();
  assert.deepEqual(a, ["Use at least 8 characters."]);
  await typeInto("Password", PW.mismatchA);
  await typeInto("Confirm password", PW.mismatchB);
  await click(byText(dialog, "button[type=submit]", "Sign up"));
  a = await alerts();
  assert.deepEqual(a, ["The two passwords don't match."]);
  await typeInto("Email", "not-an-email");
  await click(byText(dialog, "button[type=submit]", "Sign up"));
  a = await alerts();
  assert.ok(a[0].startsWith("Enter a valid email address"), a.join("|"));
  assert.equal((await calls()).length, 0, "nothing was sent while the form was invalid");
  // A too-long password (over 72 bytes) is refused rather than silently cut short.
  await typeInto("Email", "new@example.com");
  await typeInto("Password", "a".repeat(73));
  await typeInto("Confirm password", "a".repeat(73));
  await click(byText(dialog, "button[type=submit]", "Sign up"));
  assert.deepEqual(await alerts(), ["Use 72 characters or fewer."]);
});

// ================================================================================================
console.log("Log in and sign up still work");

await test("log in: the right credentials sign you in and close the dialog; the password goes only to the auth call", async () => {
  await open("/");
  await openLogin();
  await typeInto("Email", "user@example.com");
  await typeInto("Password", PW.ok);
  await click(byText(dialog, "button[type=submit]", "Log in"));
  await waitFor(`!${dialog}`, "dialog to close");
  await waitFor(`document.body.innerText.includes('Log out')`, "signed-in header");
  const c = await callsTo("POST", "/token?grant_type=password");
  assert.equal(c.length, 1);
  assert.deepEqual(c[0].body, { email: "user@example.com", password: PW.ok, gotrue_meta_security: {} });
  assert.ok((await evaluate("document.body.innerText")).includes("user@example.com"));
  const ev = await evaluate("window.__events.filter(e => e.event_name === 'login')");
  assert.equal(ev.length, 1, "one login event");
});

await test("log in: a wrong password gives one friendly message that doesn't say whether the account exists", async () => {
  await open("/");
  await openLogin();
  await typeInto("Email", "user@example.com");
  await typeInto("Password", PW.wrong);
  await click(byText(dialog, "button[type=submit]", "Log in"));
  await waitFor(`document.querySelector('[role=alert]')`, "error");
  const a1 = await alerts();
  await typeInto("Email", "nobody-at-all@example.com");
  await click(byText(dialog, "button[type=submit]", "Log in"));
  await sleep(400);
  const a2 = await alerts();
  assert.deepEqual(a1, ["Incorrect email or password."]);
  assert.deepEqual(a2, a1, "same message for an unknown address");
  assert.ok(await evaluate(`!!${dialog}`), "the dialog stays open");
  // Log in doesn't demand the new-password rules: a short old password can still be tried.
  await typeInto("Password", PW.short);
  await click(byText(dialog, "button[type=submit]", "Log in"));
  await sleep(400);
  assert.deepEqual(await alerts(), ["Incorrect email or password."], "a short password is sent to the server, not rejected by the form");
});

await test("sign up: valid details create the account request and ask you to confirm your email", async () => {
  await open("/");
  await click(byText("document", "header button", "Sign up free"));
  await waitFor(dialog, "dialog");
  await typeInto("Email", "new@example.com");
  await typeInto("Password", PW.signup);
  await typeInto("Confirm password", PW.signup);
  await click(byText(dialog, "button[type=submit]", "Sign up"));
  await waitFor(`document.querySelector('[role=status]')`, "confirmation notice");
  const c = await callsTo("POST", "/signup");
  assert.equal(c.length, 1);
  assert.equal(c[0].body.email, "new@example.com");
  assert.equal(c[0].body.password, PW.signup);
  // The confirmation link returns to the site the person signed up on (production in production, localhost locally).
  assert.equal(new URL(SUPABASE_URL + "/auth/v1" + c[0].path).searchParams.get("redirect_to"), BASE, "sign-up sends emailRedirectTo = this site");
  assert.equal(await evaluate(`document.querySelector('[role=status]').innerText`), "Check your email to confirm your account, then log in.");
  assert.equal(await modalTitle(), "Log in", "moves to the log-in form");
  assert.equal(await evaluate(`${inputFor("Password")}.value`), "", "the typed password is cleared");
  const ev = await evaluate("window.__events.filter(e => e.event_name === 'signup_completed').length");
  assert.equal(ev, 1);
});

await test("sign up: an existing address gets a neutral message that doesn't confirm an account exists", async () => {
  await open("/");
  await click(byText("document", "header button", "Sign up free"));
  await waitFor(dialog, "dialog");
  await typeInto("Email", "taken@example.com");
  await typeInto("Password", PW.signup);
  await typeInto("Confirm password", PW.signup);
  await click(byText(dialog, "button[type=submit]", "Sign up"));
  await waitFor(`document.querySelector('[role=alert]')`, "error");
  const a = (await alerts())[0];
  assert.ok(!/already registered|already exists|taken/i.test(a), a);
  assert.match(a, /couldn't create that account/i);
});

// ================================================================================================
console.log("Forgot password");

async function openForgot() {
  await open("/");
  await openLogin();
  await click(byText(dialog, "button", "Forgot password?"));
  await waitFor(`${dialog}.querySelector('h2').innerText === 'Reset your password'`, "the forgot form");
}

await test("the log-in screen has a Forgot password? link that opens a simple email form with a way back", async () => {
  await open("/");
  await openLogin();
  assert.ok(await evaluate(`!!${byText(dialog, "button", "Forgot password?")}`));
  assert.equal(await evaluate(`${byText(dialog, "button", "Forgot password?")}.type`), "button");
  await click(byText(dialog, "button", "Forgot password?"));
  await waitFor(`${dialog}.querySelector('h2').innerText === 'Reset your password'`, "form");
  const s = await evaluate(`(() => { const d = ${dialog}; return { fields: [...d.querySelectorAll('input')].map(i => i.type), submit: d.querySelector('button[type=submit]').innerText, focused: document.activeElement.type }; })()`);
  assert.deepEqual(s, { fields: ["email"], submit: "Send reset link", focused: "email" });
  await click(byText(dialog, "button", "Back to log in"));
  await waitFor(`${dialog}.querySelector('h2').innerText === 'Log in'`, "back on log in");
});

await test("the email is validated before anything is sent", async () => {
  await openForgot();
  await click(byText(dialog, "button[type=submit]", "Send reset link"));
  assert.deepEqual(await alerts(), ["Enter your email address."]);
  await typeInto("Email", "no-at-sign");
  await click(byText(dialog, "button[type=submit]", "Send reset link"));
  assert.ok((await alerts())[0].startsWith("Enter a valid email address"));
  assert.equal((await calls()).length, 0);
});

await test("a valid request goes through the existing Supabase auth, with the right redirect, and shows a clear confirmation", async () => {
  await openForgot();
  await typeInto("Email", "user@example.com");
  await click(byText(dialog, "button[type=submit]", "Send reset link"));
  await waitFor(`${dialog}.querySelector('h2').innerText === 'Check your email'`, "confirmation");
  const c = await callsTo("POST", "/recover");
  assert.equal(c.length, 1);
  const redirect = new URL(SUPABASE_URL + "/auth/v1" + c[0].path).searchParams.get("redirect_to");
  assert.equal(redirect, `${BASE}/reset-password`);
  assert.equal(c[0].body.email, "user@example.com");
  assert.ok(c[0].body.code_challenge && c[0].body.code_challenge_method, "PKCE challenge is sent");
  assert.ok(!("password" in c[0].body));
  const text = await evaluate(`${dialog}.innerText`);
  assert.match(text, /If an account exists for user@example\.com, we've sent a link to reset its password/);
  assert.match(text, /expires after about an hour/);
  const s = await evaluate(`(() => { const b = [...${dialog}.querySelectorAll('button')].map(x => x.innerText.trim()); return b; })()`);
  assert.ok(s.includes("Back to log in") && s.some((t) => t.startsWith("Send again in")), s.join("|"));
  assert.equal(await evaluate(`${byText(dialog, "button", "Back to log in")} !== undefined`), true);
  const ev = await evaluate("window.__events.filter(e => e.properties && e.properties.feature === 'password_reset_requested')");
  assert.equal(ev.length, 1);
  assert.deepEqual(Object.keys(ev[0].properties), ["feature"], "the event carries no email or other detail");
  // The way back.
  await click(byText(dialog, "button", "Back to log in"));
  await waitFor(`${dialog}.querySelector('h2').innerText === 'Log in'`, "back to log in");
});

await test("the confirmation is identical for an address with no account (nothing about it is revealed)", async () => {
  await openForgot();
  await typeInto("Email", "no-such-person@example.com");
  await click(byText(dialog, "button[type=submit]", "Send reset link"));
  await waitFor(`${dialog}.querySelector('h2').innerText === 'Check your email'`, "confirmation");
  const unknown = (await evaluate(`${dialog}.innerText`)).replace("no-such-person@example.com", "ADDR");
  await openForgot();
  await typeInto("Email", "user@example.com");
  await click(byText(dialog, "button[type=submit]", "Send reset link"));
  await waitFor(`${dialog}.querySelector('h2').innerText === 'Check your email'`, "confirmation");
  const known = (await evaluate(`${dialog}.innerText`)).replace("user@example.com", "ADDR");
  assert.equal(unknown, known);
});

await test("errors are handled gracefully: rate limit, server failure, and server-side invalid address", async () => {
  await openForgot();
  await typeInto("Email", "ratelimit@example.com");
  await click(byText(dialog, "button[type=submit]", "Send reset link"));
  await waitFor(`document.querySelector('[role=alert]')`, "rate-limit message");
  assert.deepEqual(await alerts(), ["Too many attempts. Please wait a few minutes and try again."]);
  assert.equal(await modalTitle(), "Reset your password", "no false confirmation");
  await typeInto("Email", "broken@example.com");
  await click(byText(dialog, "button[type=submit]", "Send reset link"));
  await waitFor(`document.querySelector('[role=alert]')`, "generic error");
  assert.deepEqual(await alerts(), ["Something went wrong. Please try again."]);
  assert.equal(await modalTitle(), "Reset your password");
  await typeInto("Email", "invalid@example.com");
  await click(byText(dialog, "button[type=submit]", "Send reset link"));
  await sleep(500);
  assert.ok((await alerts())[0].startsWith("Enter a valid email address"));
  // Still usable afterwards.
  await typeInto("Email", "user@example.com");
  await click(byText(dialog, "button[type=submit]", "Send reset link"));
  await waitFor(`${dialog}.querySelector('h2').innerText === 'Check your email'`, "recovers");
});

await test("Send again is held back for a minute after a request", async () => {
  await openForgot();
  await typeInto("Email", "user@example.com");
  await click(byText(dialog, "button[type=submit]", "Send reset link"));
  await waitFor(`${dialog}.querySelector('h2').innerText === 'Check your email'`, "confirmation");
  const disabled = await evaluate(`[...${dialog}.querySelectorAll('button')].find(b => b.innerText.startsWith('Send again in')).disabled`);
  assert.equal(disabled, true);
});

// ================================================================================================
console.log("The reset page (the emailed link)");

// Requests a reset (so this browser holds the one-time code verifier, exactly as a real request does),
// then opens the link as the email would.
async function requestThenOpenLink(query) {
  await openForgot();
  await typeInto("Email", "user@example.com");
  await click(byText(dialog, "button[type=submit]", "Send reset link"));
  await waitFor(`${dialog}.querySelector('h2').innerText === 'Check your email'`, "confirmation");
  const hasVerifier = await evaluate(`document.cookie.includes('code-verifier')`);
  assert.equal(hasVerifier, true, "the browser holds the one-time code verifier");
  await open(`/reset-password${query}`, { keep: true });
}

await test("opening a good link shows the new-password form for that account, and the link's code is removed from the address", async () => {
  await requestThenOpenLink("?code=goodcode");
  await waitFor(`document.querySelector('main h1') && document.querySelector('main h1').innerText === 'Choose a new password'`, "the form");
  const x = await callsTo("POST", "/token?grant_type=pkce");
  assert.equal(x.length, 1);
  assert.equal(x[0].body.auth_code, "goodcode");
  assert.ok(x[0].body.code_verifier);
  assert.equal(await evaluate("location.search"), "", "the code is gone from the address");
  assert.match(await evaluate("document.querySelector('main').innerText"), /For\s+user@example\.com/);
  const s = await evaluate(`(() => { const inputs = [...document.querySelectorAll('main input')]; return inputs.map(i => ({ type: i.type, ac: i.autocomplete })); })()`);
  assert.deepEqual(s, [{ type: "password", ac: "new-password" }, { type: "password", ac: "new-password" }]);
  const eyes = await evaluate(`[...document.querySelectorAll('main button[aria-controls]')].map(b => b.getAttribute('aria-label'))`);
  assert.deepEqual(eyes, ["Show new password", "Show confirm new password"]);
});

await test("the form survives a reload (the recovery session is kept for this tab)", async () => {
  await send("Page.reload");
  await waitFor(`document.querySelector('main h1') && document.querySelector('main h1').innerText === 'Choose a new password'`, "the form after reload");
});

await test("new password rules: empty, short, mismatched, and the eyes work on both fields", async () => {
  await click(`document.querySelector('main button[type=submit]')`);
  assert.deepEqual(await alerts(), ["Enter a password.", "Type your password again to confirm it."]);
  await typeInto("New password", PW.short);
  await typeInto("Confirm new password", PW.short);
  await click(`document.querySelector('main button[type=submit]')`);
  assert.deepEqual(await alerts(), ["Use at least 8 characters."]);
  await typeInto("New password", PW.mismatchA);
  await typeInto("Confirm new password", PW.mismatchB);
  await click(`document.querySelector('main button[type=submit]')`);
  assert.deepEqual(await alerts(), ["The two passwords don't match."]);
  assert.equal((await callsTo("PUT", "/user")).length, 0, "nothing was sent while invalid");
  await realClick(`document.querySelector('main button[aria-label="Show new password"]')`);
  await realClick(`document.querySelector('main button[aria-label="Show confirm new password"]')`);
  let t = await evaluate(`[...document.querySelectorAll('main input')].map(i => i.type)`);
  assert.deepEqual(t, ["text", "text"]);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('main input')].map(i => i.value)`), [PW.mismatchA, PW.mismatchB], "typing intact");
  await realClick(`document.querySelector('main button[aria-label="Hide new password"]')`);
  await realClick(`document.querySelector('main button[aria-label="Hide confirm new password"]')`);
  t = await evaluate(`[...document.querySelectorAll('main input')].map(i => i.type)`);
  assert.deepEqual(t, ["password", "password"], "masked again");
  assert.equal((await callsTo("PUT", "/user")).length, 0, "the eyes didn't submit the form");
});

await test("server refusals are explained: same password, weak password", async () => {
  await typeInto("New password", PW.same);
  await typeInto("Confirm new password", PW.same);
  await click(`document.querySelector('main button[type=submit]')`);
  await waitFor(`document.querySelector('main [role=alert]')`, "same-password message");
  assert.deepEqual(await alerts(), ["Your new password must be different from your current one."]);
  await typeInto("New password", PW.weak);
  await typeInto("Confirm new password", PW.weak);
  await click(`document.querySelector('main button[type=submit]')`);
  await sleep(500);
  assert.deepEqual(await alerts(), ["Password is known to be weak and easy to guess, please choose a different one."]);
  assert.equal(await evaluate(`document.querySelector('main h1').innerText`), "Choose a new password", "still on the form");
});

await test("a valid new password is saved, the fields are cleared, and you are returned to the app signed in", async () => {
  await typeInto("New password", PW.fresh);
  await typeInto("Confirm new password", PW.fresh);
  await click(`document.querySelector('main button[type=submit]')`);
  await waitFor(`document.querySelector('main h1') && document.querySelector('main h1').innerText === 'Password updated'`, "success");
  const puts = (await callsTo("PUT", "/user")).filter((c) => c.body.password === PW.fresh);
  assert.equal(puts.length, 1);
  // The password, plus the PKCE challenge fields supabase-js itself adds (a hash of a one-time value).
  assert.deepEqual(Object.keys(puts[0].body).sort(), ["code_challenge", "code_challenge_method", "password"], "nothing else about the person is sent");
  assert.equal(await evaluate(`sessionStorage.getItem('ds_password_recovery')`), null, "the recovery marker is cleared");
  const done = await evaluate("window.__events.filter(e => e.properties && e.properties.feature === 'password_reset_completed')");
  assert.equal(done.length, 1);
  assert.deepEqual(Object.keys(done[0].properties), ["feature"]);
  assert.ok(await evaluate(`!!document.querySelector('main a[href="/"]')`), "a Continue button");
  await waitFor(`location.pathname === '/'`, "the automatic return to the app", 8000);
});

await test("an expired link (error in the address) says so and offers a new one", async () => {
  await open("/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  await waitFor(`document.querySelector('main h1') && document.querySelector('main h1').innerText.includes('expired')`, "the expired message", 8000);
  assert.equal(await evaluate("document.querySelector('main h1').innerText"), "This reset link has expired");
  await click(byText("document.querySelector('main')", "button", "Send me a new link"));
  await waitFor(`${dialog} && ${dialog}.querySelector('h2').innerText === 'Reset your password'`, "the forgot form");
});

await test("opening the page with no link at all is handled: a clear message and the way to get a new link", async () => {
  await open("/reset-password");
  await waitFor(`document.querySelector('main h1') && document.querySelector('main h1').innerText === "This reset link can't be used"`, "invalid message", 8000);
  assert.equal((await callsTo("PUT", "/user")).length, 0);
  const s = await evaluate(`[...document.querySelectorAll('main button, main a')].map(x => x.innerText.trim())`);
  assert.deepEqual(s, ["Send me a new link", "Back to log in", "Go to DocuScanner"]);
  await click(byText("document.querySelector('main')", "button", "Back to log in"));
  await waitFor(`${dialog} && ${dialog}.querySelector('h2').innerText === 'Log in'`, "log-in dialog");
});

await test("a link opened in a DIFFERENT browser (no code verifier here) is treated as invalid, and the code is never exchanged", async () => {
  await open("/reset-password?code=goodcode");
  await waitFor(`document.querySelector('main h1') && document.querySelector('main h1').innerText === "This reset link can't be used"`, "invalid message", 8000);
  assert.equal((await callsTo("POST", "/token?grant_type=pkce")).length, 0);
});

await test("a used or expired code (the server refuses it) is invalid, not a crash", async () => {
  await requestThenOpenLink("?code=expiredcode");
  await waitFor(`document.querySelector('main h1') && document.querySelector('main h1').innerText === "This reset link can't be used"`, "invalid message", 8000);
  assert.equal((await callsTo("POST", "/token?grant_type=pkce")).length, 1);
  assert.equal((await callsTo("PUT", "/user")).length, 0);
});

await test("if the recovery session is lost while you type (link expired), you get the invalid-link screen", async () => {
  await requestThenOpenLink("?code=goodcode");
  await waitFor(`document.querySelector('main h1') && document.querySelector('main h1').innerText === 'Choose a new password'`, "the form");
  await typeInto("New password", PW.lost);
  await typeInto("Confirm new password", PW.lost);
  await click(`document.querySelector('main button[type=submit]')`);
  await waitFor(`document.querySelector('main h1') && document.querySelector('main h1').innerText === "This reset link can't be used"`, "invalid message", 8000);
});

await test("a normal signed-in visit to /reset-password is not a way to change the password", async () => {
  await open("/");
  await openLogin();
  await typeInto("Email", "user@example.com");
  await typeInto("Password", PW.ok);
  await click(byText(dialog, "button[type=submit]", "Log in"));
  await waitFor(`document.body.innerText.includes('Log out')`, "signed in");
  await open("/reset-password", { keep: true });
  await waitFor(`document.querySelector('main h1') && document.querySelector('main h1').innerText === "This reset link can't be used"`, "invalid message", 8000);
});

// ================================================================================================
console.log("Nothing sensitive leaks");

await test("no password appears in the console, exceptions, analytics, addresses or storage", async () => {
  // Storage as it is right now, after a real sign-in.
  await open("/");
  await openLogin();
  await typeInto("Email", "user@example.com");
  await typeInto("Password", PW.ok);
  await click(byText(dialog, "button[type=submit]", "Log in"));
  await waitFor(`document.body.innerText.includes('Log out')`, "signed in");
  const storage = await evaluate(`JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, c: document.cookie })`);
  const cookies = JSON.stringify((await send("Network.getAllCookies")).cookies.map((c) => c.value));
  const analytics = JSON.stringify(await evaluate("window.__events"));
  const surfaces = { console: consoleText.join("\n"), analytics, urls: visitedUrls.join("\n"), storage, cookies };
  for (const [name, text] of Object.entries(surfaces)) {
    for (const [label, secret] of Object.entries(PW)) {
      assert.ok(!text.includes(secret), `the password "${label}" appears in ${name}`);
    }
  }
  log(`checked ${consoleText.length} console lines, ${visitedUrls.length} addresses, storage and cookies, and analytics: none contain a password`);
  const errors = consoleText.filter((l) => /^(error|exception|log error)/.test(l));
  assert.deepEqual(errors, [], errors.join("\n"));
});

await test("analytics only ever carry safe error codes (no messages, emails or tokens)", async () => {
  await open("/");
  await openLogin();
  await typeInto("Email", "user@example.com");
  await typeInto("Password", PW.wrong);
  await click(byText(dialog, "button[type=submit]", "Log in"));
  await waitFor(`document.querySelector('[role=alert]')`, "error");
  await sleep(400);
  const errs = await evaluate("window.__events.filter(e => e.event_name === 'error')");
  assert.ok(errs.length >= 1);
  const login = errs.find((e) => e.properties.context === "login");
  assert.deepEqual(login.properties, { context: "login", message: "invalid_credentials" });
  const all = JSON.stringify(await evaluate("window.__events"));
  assert.ok(!all.includes("user@example.com"), "no email address in analytics");
  assert.ok(!/Invalid login credentials/i.test(all), "no server message in analytics");
});

await test("the analytics referrer drops the query string, so an emailed link's one-time token never reaches it", async () => {
  await open("/");
  // The browser's own policy usually trims the referrer already; give the page a raw one, as an
  // older or laxer browser could, and make a real client-side page view.
  await evaluate(`Object.defineProperty(document, 'referrer', { configurable: true, get: () => 'https://example.supabase.co/auth/v1/verify?token=SECRET-ONE-TIME-TOKEN&type=recovery&redirect_to=x#frag' }); window.__events.length = 0;`);
  await click(`[...document.querySelectorAll('header a')].find(a => a.getAttribute('href') === '/scan')`);
  await waitFor("window.__events.some(e => e.event_name === 'page_view')", "a page view");
  const ev = await evaluate("window.__events.filter(e => e.event_name === 'page_view')");
  const text = JSON.stringify(ev);
  assert.ok(!text.includes("SECRET-ONE-TIME-TOKEN"), "token in the referrer");
  assert.ok(!text.includes("frag"), "fragment in the referrer");
  assert.equal(ev[0].referrer, "https://example.supabase.co/auth/v1/verify");
  log("referrer sent: " + ev[0].referrer);
});

// ================================================================================================
console.log("Layout: 375px, 390px and desktop");

for (const width of [375, 390, 1280]) {
  await test(`${width}px: the eye sits inside the password field, is 44px, doesn't overflow, and long passwords don't run under it`, async () => {
    await open("/", { width, height: width < 800 ? 812 : 900, mobile: width < 800 });
    await openLogin();
    await typeInto("Email", "user@example.com");
    await typeInto("Password", "a-very-long-password-that-needs-more-room-than-the-box-has-to-show-1234567890");
    await realClick(`${dialog}.querySelector('button[aria-controls]')`);
    const g = await evaluate(`(() => {
      const d = ${dialog}; const card = d.firstElementChild.getBoundingClientRect();
      const i = ${inputFor("Password")}; const ir = i.getBoundingClientRect();
      const b = d.querySelector('button[aria-controls]').getBoundingClientRect();
      const cs = getComputedStyle(i);
      return { vw: innerWidth, scrollW: document.documentElement.scrollWidth, card: { l: card.left, r: card.right }, input: { l: ir.left, r: ir.right, w: ir.width, h: ir.height }, btn: { l: b.left, r: b.right, w: b.width, h: b.height, t: b.top, bt: b.bottom, it: ir.top, ib: ir.bottom }, padRight: parseFloat(cs.paddingRight), type: i.type };
    })()`);
    log(JSON.stringify({ input: `${Math.round(g.input.w)}x${Math.round(g.input.h)}`, button: `${Math.round(g.btn.w)}x${Math.round(g.btn.h)}`, padRight: g.padRight }));
    assert.ok(g.scrollW <= g.vw, `page overflows sideways (${g.scrollW} > ${g.vw})`);
    assert.ok(g.card.l >= 0 && g.card.r <= g.vw, "dialog inside the screen");
    assert.ok(g.btn.l >= g.input.l && g.btn.r <= g.input.r + 0.5, "eye inside the field");
    assert.ok(g.btn.t >= g.btn.it - 0.5 && g.btn.bt <= g.btn.ib + 0.5, `eye vertically inside the field (button ${g.btn.t}-${g.btn.bt}, field ${g.btn.it}-${g.btn.ib})`);
    assert.ok(g.btn.w >= 44 && g.btn.h >= 44, "44px target");
    assert.ok(g.padRight >= g.btn.w, "text stops before the eye");
    assert.ok(g.input.w >= 200, "the field is still comfortably wide");
    assert.equal(g.type, "text", "revealed while checking");
    await send("Page.captureScreenshot", { format: "png" }).then((s) => fs.writeFileSync(path.join(outDir, `login-${width}.png`), Buffer.from(s.data, "base64")));
  });

  await test(`${width}px: the forgot-password form, its confirmation and the reset page fit`, async () => {
    await open("/", { width, height: width < 800 ? 812 : 900, mobile: width < 800 });
    await openLogin();
    await click(byText(dialog, "button", "Forgot password?"));
    await waitFor(`${dialog}.querySelector('h2').innerText === 'Reset your password'`, "forgot");
    let fits = await evaluate(`(() => { const r = ${dialog}.firstElementChild.getBoundingClientRect(); return document.documentElement.scrollWidth <= innerWidth && r.left >= 0 && r.right <= innerWidth; })()`);
    assert.ok(fits, "forgot form fits");
    await typeInto("Email", "user@example.com");
    await click(byText(dialog, "button[type=submit]", "Send reset link"));
    await waitFor(`${dialog}.querySelector('h2').innerText === 'Check your email'`, "confirmation");
    fits = await evaluate(`(() => { const r = ${dialog}.firstElementChild.getBoundingClientRect(); return document.documentElement.scrollWidth <= innerWidth && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight + 1; })()`);
    assert.ok(fits, "confirmation fits");
    await send("Page.captureScreenshot", { format: "png" }).then((s) => fs.writeFileSync(path.join(outDir, `forgot-${width}.png`), Buffer.from(s.data, "base64")));
    await open("/reset-password?code=goodcode", { width, height: width < 800 ? 812 : 900, mobile: width < 800, keep: true });
    await waitFor(`document.querySelector('main h1') && document.querySelector('main h1').innerText === 'Choose a new password'`, "reset form");
    await typeInto("New password", "Some-Long-New-Password-For-Testing-1234567890");
    await realClick(`document.querySelector('main button[aria-label="Show new password"]')`);
    const g = await evaluate(`(() => { const i = [...document.querySelectorAll('main input')][0].getBoundingClientRect(); const b = document.querySelector('main button[aria-controls]').getBoundingClientRect(); return { fitsPage: document.documentElement.scrollWidth <= innerWidth, inField: b.right <= i.right + 0.5 && b.left >= i.left, w: b.width, h: b.height }; })()`);
    assert.ok(g.fitsPage && g.inField && g.w >= 44 && g.h >= 44, JSON.stringify(g));
    await send("Page.captureScreenshot", { format: "png" }).then((s) => fs.writeFileSync(path.join(outDir, `reset-${width}.png`), Buffer.from(s.data, "base64")));
  });
}

// ================================================================================================
console.log("The real server");

await test("the real project answers a recovery request the same way whether or not the address has an account", async () => {
  if (process.env.SKIP_REAL) return log("(skipped: SKIP_REAL)");
  const key = ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key) return log("(skipped: no publishable key in .env.local)");
  const ask = async (email) => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, { method: "POST", headers: { apikey: key, "content-type": "application/json" }, body: JSON.stringify({ email }) });
    const text = await res.text();
    return { status: res.status, body: text };
  };
  // Two addresses that certainly have no account: no email is sent to anyone.
  const a = await ask(`no-such-user-${Date.now()}-a@example.invalid`);
  const b = await ask(`no-such-user-${Date.now()}-b@example.invalid`);
  log(`real server: ${a.status} ${a.body.slice(0, 80)} | ${b.status} ${b.body.slice(0, 80)}`);
  assert.equal(a.status, b.status);
  assert.equal(a.body, b.body);
  assert.ok([200, 400, 422, 429].includes(a.status), `unexpected status ${a.status}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) console.log("console errors seen:\n  " + consoleText.filter((l) => /^(error|exception)/.test(l)).slice(0, 6).join("\n  "));
chrome.kill();
process.exit(failed === 0 ? 0 : 1);
