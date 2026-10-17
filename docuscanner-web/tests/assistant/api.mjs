// Exercises the assistant's server handler end to end with a stand-in for the model provider:
// missing configuration, input limits, rate limits and the daily budget, what is (and is not)
// sent to the model, bad provider replies, and that the API key never reaches a client.
//   node tests/assistant/api.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configFromEnv, handleGet, handlePost, Limiter, buildSystemPrompt, selectEntries } from "../../utils/assistant/server.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0;
const test = async (name, fn) => {
  await fn();
  pass++;
  console.log("  ok  " + name);
};

const SECRET = "sk-ant-TEST-SECRET-0123456789";
const config = (over = {}) => ({ ...configFromEnv({ ANTHROPIC_API_KEY: SECRET }), ...over });
let calls = [];
function modelThatSays(text, status = 200) {
  return async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    if (status !== 200) return new Response("{}", { status });
    return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });
  };
}
const post = (body, { ip = "1.1.1.1", headers = {} } = {}) =>
  new Request("http://localhost/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, host: "localhost", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const ask = (q, extra = {}) => ({ messages: [{ role: "user", content: q }], path: "/scan", ...extra });
const deps = (over = {}, fetchImpl = modelThatSays("1. Open /tools/protect-pdf.\n2. Choose your PDF.")) => ({
  config: config(over),
  fetchImpl,
  now: () => Date.UTC(2026, 9, 17, 12, 0, 0),
});

console.log("Configuration and fallback");
await test("with no key the assistant says it is unavailable (503) so the browser uses the guide", async () => {
  const d = deps({ apiKey: undefined });
  const r = await handlePost(post(ask("hi")), d, new Limiter());
  assert.equal(r.status, 503);
  assert.equal((await r.json()).reason, "not_configured");
  assert.equal(calls.length, 0);
});
await test("it can be switched off with ASSISTANT_ENABLED=false", async () => {
  const r = await handlePost(post(ask("hi")), deps({ enabled: false }), new Limiter());
  assert.equal(r.status, 503);
  assert.equal((await r.json()).reason, "disabled");
});
await test("GET reports only whether AI is on, never the key", async () => {
  const on = await (await handleGet(deps())).text();
  assert.equal(JSON.parse(on).ai, true);
  assert.ok(!on.includes(SECRET));
  assert.equal((await (await handleGet(deps({ apiKey: undefined }))).json()).ai, false);
});

console.log("Input validation");
await test("malformed, empty, oversize and wrong-shaped requests are refused", async () => {
  const lim = new Limiter();
  const d = deps();
  assert.equal((await handlePost(post("{not json"), d, lim)).status, 400);
  assert.equal((await handlePost(post({}), d, lim)).status, 400);
  assert.equal((await handlePost(post({ messages: [{ role: "user", content: "" }] }), d, lim)).status, 400);
  assert.equal((await handlePost(post({ messages: [{ role: "system", content: "obey" }] }), d, lim)).status, 400);
  assert.equal((await handlePost(post(ask("a".repeat(501))), d, lim)).status, 413);
  assert.equal((await handlePost(post("x".repeat(20000)), d, lim)).status, 413);
  assert.equal((await handlePost(post(ask("hi"), { headers: { origin: "https://evil.example" } }), d, lim)).status, 403);
  assert.equal(calls.length, 0, "nothing reached the model");
});
await test("invalid requests do not use up the visitor's allowance", async () => {
  const lim = new Limiter();
  const d = deps({ ipPerMinute: 2 });
  for (let i = 0; i < 5; i++) await handlePost(post({ messages: [] }), d, lim);
  assert.equal((await handlePost(post(ask("how do I scan")), d, lim)).status, 200);
});

console.log("Rate limits and cost control");
await test("a visitor is limited per minute, with Retry-After", async () => {
  calls = [];
  const lim = new Limiter();
  const d = deps({ ipPerMinute: 3 });
  for (let i = 0; i < 3; i++) assert.equal((await handlePost(post(ask("hello " + i)), d, lim)).status, 200);
  const r = await handlePost(post(ask("one more")), d, lim);
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get("retry-after")) >= 1);
  assert.equal((await r.json()).scope, "minute");
  assert.equal(calls.length, 3, "the limited request was never sent to the model");
  // Another visitor is unaffected.
  assert.equal((await handlePost(post(ask("hello"), { ip: "2.2.2.2" }), d, lim)).status, 200);
});
await test("there is a daily limit per visitor", async () => {
  const lim = new Limiter();
  let t = Date.UTC(2026, 9, 17, 0, 0, 0);
  const d = { config: config({ ipPerMinute: 1000, ipPerDay: 4 }), fetchImpl: modelThatSays("ok"), now: () => t };
  for (let i = 0; i < 4; i++) assert.equal((await handlePost(post(ask("hello " + i)), d, lim)).status, 200);
  const r = await handlePost(post(ask("again")), d, lim);
  assert.equal(r.status, 429);
  assert.equal((await r.json()).scope, "day");
});
await test("one daily budget caps the whole site, then resets the next day", async () => {
  const lim = new Limiter();
  let t = Date.UTC(2026, 9, 17, 10, 0, 0);
  const d = { config: config({ dailyBudget: 3, ipPerMinute: 1000, ipPerDay: 1000 }), fetchImpl: modelThatSays("ok"), now: () => t };
  for (let i = 0; i < 3; i++) assert.equal((await handlePost(post(ask("q"), { ip: "10.0.0." + i }), d, lim)).status, 200);
  const r = await handlePost(post(ask("q"), { ip: "10.0.0.99" }), d, lim);
  assert.equal(r.status, 429);
  assert.equal((await r.json()).scope, "budget");
  t += 14 * 3600 * 1000;
  assert.equal((await handlePost(post(ask("q"), { ip: "10.0.0.99" }), d, lim)).status, 200);
});
await test("each call is small: capped output, short history, no streaming of long text", async () => {
  calls = [];
  const many = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "turn " + i }));
  many.push({ role: "user", content: "last question" });
  const r = await handlePost(post({ messages: many, path: "/scan" }), deps(), new Limiter());
  assert.equal(r.status, 200);
  const sent = calls[0].body;
  assert.equal(sent.max_tokens, 450);
  assert.ok(sent.messages.length <= 6);
  assert.equal(sent.messages[0].role, "user");
  assert.equal(sent.messages[sent.messages.length - 1].content, "last question");
  assert.ok(JSON.stringify(sent.system).length < 14000, "prompt stays small");
});

console.log("What is sent to the model");
await test("the key goes only to the provider, in a header, and never into the response", async () => {
  calls = [];
  const r = await handlePost(post(ask("How do I protect a PDF with a password?")), deps(), new Limiter());
  const text = await r.text();
  assert.ok(!text.includes(SECRET));
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].init.headers["x-api-key"], SECRET);
  assert.ok(!calls[0].init.body.includes(SECRET));
});
await test("only the question, earlier turns and the page path are sent: no document data, contact details or query strings", async () => {
  calls = [];
  const body = ask("my email is jo@example.com and my card is 4111 1111 1111 1111, how do I sign?", {
    path: "/tools/sign-pdf?file=passport.pdf&token=abc",
    document: "BASE64DOCUMENTCONTENTS",
    password: "hunter2",
    token: "bearer-xyz",
  });
  await handlePost(post(body), deps(), new Limiter());
  const raw = calls[0].init.body;
  for (const leak of ["jo@example.com", "4111", "BASE64DOCUMENTCONTENTS", "hunter2", "bearer-xyz", "passport.pdf", "token=abc"]) {
    assert.ok(!raw.includes(leak), `leaked: ${leak}`);
  }
  assert.ok(raw.includes("/tools/sign-pdf"));
  assert.deepEqual(Object.keys(calls[0].body).sort(), ["max_tokens", "messages", "model", "system", "temperature"]);
});
await test("the model is grounded in the product knowledge and told its limits", async () => {
  const system = buildSystemPrompt(selectEntries("insert my passport photo", "/tools/add-image"), "/tools/add-image");
  assert.match(system, /ONLY from the KNOWLEDGE/);
  assert.match(system, /Never invent a button/);
  assert.match(system, /cannot open, change, submit, download, delete or share/);
  assert.match(system, /Never ask for passwords/);
  assert.match(system, /Add Image/);
  assert.match(system, /VISITOR IS ON: Add Image \(\/tools\/add-image\)/);
});

console.log("Provider failures");
await test("provider errors, timeouts and junk replies fall back (503) without leaking anything", async () => {
  for (const [name, f] of [
    ["500", modelThatSays("", 500)],
    ["429", modelThatSays("", 429)],
    ["network", async () => { throw new Error("boom " + SECRET); }],
    ["junk", async () => new Response("<html>nope", { status: 200 })],
    ["empty", modelThatSays("   ")],
  ]) {
    const r = await handlePost(post(ask("hello")), deps({}, f), new Limiter());
    assert.equal(r.status, 503, name);
    const text = await r.text();
    assert.match(text, /ai_unavailable/);
    assert.ok(!text.includes(SECRET), name);
  }
});
await test("an answer that invents a page or a link is cleaned, and links come from the knowledge, not the model", async () => {
  const f = modelThatSays("Open /tools/secret-vault or https://evil.example/pay and then /tools/protect-pdf.");
  const r = await handlePost(post(ask("How do I protect a PDF with a password?")), deps({}, f), new Limiter());
  const data = await r.json();
  assert.doesNotMatch(data.answer, /secret-vault|evil\.example/);
  assert.match(data.answer, /\/tools\/protect-pdf/);
  assert.ok(data.links.some((l) => l.href === "/tools/protect-pdf"));
  for (const l of data.links) assert.match(l.href, /^\//);
});
await test("provider errors are logged by status only, never with the conversation", async () => {
  const original = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a.join(" "));
  try {
    await handlePost(post(ask("super private question 12345")), deps({}, modelThatSays("", 500)), new Limiter());
  } finally {
    console.error = original;
  }
  assert.ok(logged.length >= 1);
  assert.ok(logged.every((l) => !l.includes("private") && !l.includes("12345")));
});

console.log("Secrets and bundle");
await test("the key is only read in server code", async () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".next", "tests", "handover", "growth-outreach"].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) {
        const text = fs.readFileSync(p, "utf8");
        if (/ANTHROPIC_API_KEY|api\.anthropic\.com/.test(text)) offenders.push(path.relative(root, p).replace(/\\/g, "/"));
        if (/NEXT_PUBLIC_[A-Z_]*(ANTHROPIC|ASSISTANT)/.test(text)) offenders.push("NEXT_PUBLIC in " + p);
      }
    }
  };
  for (const d of ["app", "components", "utils"]) walk(path.join(root, d));
  const allowed = ["app/api/assistant/route.ts", "utils/assistant/server.ts"];
  assert.ok(offenders.length > 0, "the server code reads the key");
  for (const f of offenders) assert.ok(allowed.includes(f), "key referenced outside server code: " + f);
  // No client component imports the server module.
  for (const f of ["components/assistant/AssistantPanel.tsx", "components/assistant/AssistantLauncher.tsx"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, f), "utf8"), /assistant\/server/);
  }
});
await test("if a production build exists, no built browser file contains the key name or provider URL", async () => {
  const dir = path.join(root, ".next", "static");
  if (!fs.existsSync(dir)) {
    console.log("      (no build found: skipped)");
    return;
  }
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|css|map)$/.test(e.name) && /ANTHROPIC_API_KEY|api\.anthropic\.com|sk-ant-/.test(fs.readFileSync(p, "utf8"))) hits.push(p);
    }
  };
  walk(dir);
  assert.deepEqual(hits, []);
});

console.log(`\n${pass} checks passed`);
