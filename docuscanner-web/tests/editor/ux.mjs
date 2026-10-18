// Real-browser check of the editing workspace on phone, tablet, desktop and a wide monitor:
//   - how much room the page gets in "Edit page" and in the annotation editor (and that the tools can fold away)
//   - Move page mode, one-finger / mouse panning, zoom buttons, Fit page / Fit width, first-visit tip
//   - on-screen and keyboard arrows moving text, a signature and a picture by exact steps, and that those
//     positions survive into the downloaded PDF
//
//   npm run build && npm run start -- -p 3117      (in another terminal)
//   node tests/editor/ux.mjs [baseUrl] [--only=phone|tablet|desktop|wide]
// Set CHROME to a browser executable to override auto-detection.

import {
  addImage, addSignature, addText, assert, atFraction, boxOf, createCanvas, exportPdf, finishEditing, isPurple, isSignatureBlue, isTextRed,
  launch, LAYOUTS, makeLogo, makePdf, makeSignature, ok, openAnnotator, openWorkspace, passed, renderPages, selectAt, selection, session,
  surfaceBox, touchDrag, viewportScroll, path, work,
} from "./lib.mjs";

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const pdf = await makePdf("form.pdf", 2);
const logo = makeLogo();
const signature = makeSignature();

const browser = await launch();
const allErrors = [];
const REF_PT = 595;
const FINE = 3 / REF_PT;
const COARSE = 15 / REF_PT;
const A4_ASPECT = 595.28 / 841.89;

async function rect(page, selector) {
  return page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, display: getComputedStyle(el).display };
  });
}
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a.toFixed(4)} vs ${b.toFixed(4)} (±${tol})`);
const sameBox = (a, b, tol, msg) => {
  near(a.x, b.x, tol, msg + " x");
  near(a.y, b.y, tol, msg + " y");
  near(a.w, b.w, tol, msg + " w");
  near(a.h, b.h, tol, msg + " h");
};
const zoomLabel = (page) => page.getByRole("dialog", { name: /Annotate page/ }).getByRole("group", { name: "Zoom" }).getByRole("button").nth(1).innerText();

// Every control of the editor is reachable: inside the window, at least 44 px, and on top (not covered).
async function controlsReachable(page, vp, names, scope = page) {
  for (const name of names) {
    const target = typeof name === "string" ? scope.getByRole("button", { name, exact: true }) : name;
    const info = await target.first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { x: r.x, y: r.y, w: r.width, h: r.height, covered: !(top === el || el.contains(top)) };
    });
    const label = typeof name === "string" ? name : "control";
    assert.ok(info.x >= -0.5 && info.x + info.w <= vp.width + 0.5, `${label} is inside the screen width (${info.x.toFixed(0)}+${info.w.toFixed(0)} of ${vp.width})`);
    assert.ok(info.y >= -0.5 && info.y + info.h <= vp.height + 0.5, `${label} is inside the screen height`);
    assert.ok(info.w >= 43.5 && info.h >= 43.5, `${label} is a touch-sized target (${info.w.toFixed(0)}x${info.h.toFixed(0)})`);
    assert.ok(!info.covered, `${label} is not covered by anything`);
  }
}

async function runLayout(layout) {
  const { context, page } = await session(browser, { viewport: layout.viewport, mobile: layout.mobile });
  try {
    await runLayoutIn(layout, context, page);
  } catch (e) {
    const shot = path.join(work, "failure.png");
    await page.screenshot({ path: shot }).catch(() => undefined);
    console.error("Screenshot of the failure: " + shot);
    throw e;
  }
}

async function runLayoutIn({ label, viewport, mobile }, context, page) {
  console.log(`\n${label}`);
  const phone = viewport.width < 640;
  const errors = page.__errors;
  const vh = viewport.height;

  await openWorkspace(page, pdf, 2);
  // Before opening anything: the workspace page itself does not scroll sideways.
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "no sideways scroll on the page");

  // ---- Edit page: the page gets more room, not less -------------------------------------------------
  await page.locator('ul[aria-label="Pages"] li button').nth(0).click();
  await page.locator('[data-assistant-id="scan-edit-page"]').first().click();
  const dlg = page.getByRole("dialog", { name: /Edit page/ });
  await dlg.waitFor();
  await page.waitForTimeout(400);
  const card = await dlg.locator("> div").first().evaluate((el) => el.getBoundingClientRect().toJSON());
  const img = await rect(page, 'img[alt="Page 1 preview"]');
  const oldCap = phone || viewport.width < 1024 ? 0.45 * vh : 0.66 * vh; // the previous fixed share of the screen height
  console.log(`      Edit page: card ${card.width.toFixed(0)}x${card.height.toFixed(0)}, page ${img.w.toFixed(0)}x${img.h.toFixed(0)} px (the old limit was ${oldCap.toFixed(0)} px tall)`);
  assert.ok(img.h > oldCap * 1.12, `the page is taller than the old fixed limit (${img.h.toFixed(0)} > ${(oldCap * 1.12).toFixed(0)})`);
  assert.ok(card.width >= viewport.width * (phone ? 0.97 : 0.9) || card.width >= 1790, "the editor uses (almost) the whole width");
  assert.ok(card.height >= vh * (phone ? 0.97 : 0.9), "the editor uses (almost) the whole height");
  ok("Edit page opens large: the page is bigger than the old fixed share of the screen");

  if (!phone && viewport.width >= 1024) {
    const tools = page.locator('[data-assistant-id="page-toggle-tools"]');
    const before = await rect(page, "[data-page-stage]");
    await tools.click();
    await page.waitForTimeout(200);
    const after = await rect(page, "[data-page-stage]");
    assert.ok(after.w > before.w + 250, `hiding the tools gives the page the width (${before.w.toFixed(0)} -> ${after.w.toFixed(0)})`);
    assert.equal(await page.getByRole("button", { name: "Adjust crop" }).isVisible(), false, "tools are hidden");
    await tools.click();
    assert.equal(await page.getByRole("button", { name: "Adjust crop" }).isVisible(), true, "tools come back");
    ok("the tools column can be hidden and shown (desktop)");
  } else {
    // Phone and tablet: one column, the tools reachable by scrolling, nothing sideways.
    assert.ok(await page.getByRole("button", { name: "Adjust crop" }).count(), "the tools are still there on a narrow screen");
    ok("narrow screens keep one column with the tools below the page");
  }
  assert.ok(await dlg.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "no sideways scroll inside Edit page");
  await controlsReachable(page, viewport, ["Close editor", "Done editing"], dlg);
  await controlsReachable(page, viewport, [page.locator('[data-assistant-id="page-annotate"]')]);
  ok("Close, Done editing and Add text, signature & marks are reachable and not covered");

  // ---- the annotation editor -------------------------------------------------------------------------
  await page.locator('[data-assistant-id="page-annotate"]').click();
  const editor = page.getByRole("dialog", { name: /Annotate page/ });
  await editor.waitFor();
  await page.waitForTimeout(300);
  const stage = await rect(page, "[data-editor-stage]");
  const area = await surfaceBox(page);
  console.log(`      Annotator: stage ${stage.w.toFixed(0)}x${stage.h.toFixed(0)}, page ${area.width.toFixed(0)}x${area.height.toFixed(0)}`);
  assert.ok(area.height <= stage.h + 1 && area.width <= stage.w + 1, "the whole page fits the stage at normal size");
  assert.ok(area.height >= stage.h * 0.9 || area.width >= stage.w * 0.9, "the page fills the room it has (by height or by width)");
  const oldAnnotator = Math.min(viewport.width - 24, (vh - 260) * A4_ASPECT);
  assert.ok(area.width >= oldAnnotator * 0.985, `the annotated page is no smaller than before (within 1.5%) (${area.width.toFixed(0)} vs ${oldAnnotator.toFixed(0)})`);
  assert.ok(await editor.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "no sideways scroll in the annotation editor");
  ok("the annotation editor measures its room: the whole page fits and fills it");

  const toggle = page.locator('[data-assistant-id="annotation-toggle-tools"]');
  await toggle.click();
  await page.waitForTimeout(250);
  const roomy = await rect(page, "[data-editor-stage]");
  assert.ok(roomy.h > stage.h + 60, `hiding the tools gives the stage more room to work in (${stage.h.toFixed(0)} -> ${roomy.h.toFixed(0)} px tall)`);
  const roomyPage = await surfaceBox(page);
  assert.ok(roomyPage.height >= area.height - 1, "…and the page never gets smaller");
  await toggle.click();
  await page.waitForTimeout(250);
  ok("the toolbars can be folded away for more room and brought back");

  await controlsReachable(page, viewport, ["Undo", "Redo", "Ask for help", "Done editing", "Zoom out", "Zoom in", "Move left", "Move up", "Move down", "Move right"], editor);
  ok("every editor control is on screen, touch-sized and not covered (zoom, arrows, undo, done)");

  // ---- first-visit tip (phone only) -------------------------------------------------------------------
  const tip = page.locator('[data-editor-hint="pan"]');
  if (phone) {
    await tip.waitFor();
    assert.match(await tip.innerText(), /Move around the page using one finger, or pinch to zoom\. Select Move Page if you want to drag the canvas\./);
    await tip.getByRole("button", { name: "Dismiss this tip" }).click();
    assert.equal(await tip.count(), 0, "the tip goes away");
    await finishEditing(page);
    await openAnnotator(page, 1);
    assert.equal(await tip.count(), 0, "it does not come back on the next visit to the editor");
    ok("phone: the Move Page tip shows once, can be dismissed, and stays dismissed");
  } else {
    assert.equal(await tip.count(), 0, "no touch tip on a large screen");
    ok("large screens do not show the phone tip");
  }

  // ---- something to protect from accidental movement ------------------------------------------------
  await addText(page, 0.12, 0.3, "NUDGE-TEXT");
  await selectAt(page, 0.14, 0.31);
  const textAtStart = await selection(page);

  // ---- Move page mode ---------------------------------------------------------------------------------
  const pan = page.locator('[data-assistant-id="annotation-tool-pan"]');
  await pan.click();
  assert.equal(await pan.getAttribute("aria-pressed"), "true", "Move page is on");
  const zoomIn = editor.getByRole("button", { name: "Zoom in" });
  for (let i = 0; i < 3; i++) await zoomIn.click();
  assert.equal((await zoomLabel(page)).startsWith("200%") || (await zoomLabel(page)).includes("200%"), true, "zoomed to 200%");
  let s0 = await viewportScroll(page);
  assert.ok(s0.maxLeft > 50 || s0.maxTop > 50, "there is room to move around when zoomed in");
  const from = await atFraction(page, 0.5, 0.5);
  const centre = await page.locator("[data-editor-stage]").boundingBox();
  const start = { x: Math.min(Math.max(from.x, centre.x + 40), centre.x + centre.width - 40), y: Math.min(Math.max(from.y, centre.y + 40), centre.y + centre.height - 40) };
  if (mobile) await touchDrag(page, start, { x: start.x - 90, y: start.y - 120 });
  else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 45, start.y - 60, { steps: 4 });
    await page.mouse.move(start.x - 90, start.y - 120, { steps: 4 });
    await page.mouse.up();
  }
  await page.waitForTimeout(150);
  let s1 = await viewportScroll(page);
  assert.ok(s1.left > s0.left + 30 || s1.top > s0.top + 40, `dragging in Move page mode moves the page (${s0.left.toFixed(0)},${s0.top.toFixed(0)} -> ${s1.left.toFixed(0)},${s1.top.toFixed(0)})`);
  await page.locator('[data-assistant-id="annotation-tool-select"]').click();
  await editor.getByRole("button", { name: "Fit page" }).click();
  await page.waitForTimeout(200);
  assert.equal(await zoomLabel(page), "100%", "Fit page returns to the whole page");
  await selectAt(page, 0.14, 0.31);
  sameBox(await selection(page), textAtStart, 0.0025, "the text did not move while the page was dragged");
  ok(`${mobile ? "one finger" : "the mouse"} drags the page in Move page mode without moving the text mark`);

  // Select mode: dragging empty page moves the page (finger); dragging the mark moves the mark.
  if (mobile) {
    await editor.getByRole("button", { name: "Zoom in" }).click();
    await editor.getByRole("button", { name: "Zoom in" }).click();
    await editor.getByRole("button", { name: "Zoom in" }).click();
    const sb = await page.locator("[data-editor-stage]").boundingBox();
    const empty = { x: sb.x + sb.width * 0.5, y: sb.y + sb.height * 0.62 };
    const before = await viewportScroll(page);
    await touchDrag(page, empty, { x: empty.x - 70, y: empty.y - 90 });
    await page.waitForTimeout(150);
    const after = await viewportScroll(page);
    assert.ok(after.left > before.left + 20 || after.top > before.top + 25, "a finger dragging empty page in Select mode moves the page");
    await editor.getByRole("button", { name: "Fit page" }).click();
    await page.waitForTimeout(150);
    sameBox(await selection(page), textAtStart, 0.0025, "the mark stayed put");
    const pt = await atFraction(page, textAtStart.x + textAtStart.w / 2, textAtStart.y + textAtStart.h / 2);
    await touchDrag(page, pt, { x: pt.x, y: pt.y + 60 }, 6);
    await page.waitForTimeout(150);
    const moved = await selection(page);
    assert.ok(moved.y > textAtStart.y + 0.03, "a finger dragging the mark still moves the mark");
    await editor.getByRole("button", { name: "Undo" }).click();
    ok("one finger: empty page pans, a mark under the finger moves");
  }

  // Fit width / Fit page
  await editor.getByRole("button", { name: "Fit width" }).click();
  await page.waitForTimeout(200);
  const fw = await surfaceBox(page);
  const stageNow = await rect(page, "[data-editor-stage]");
  assert.ok(fw.width >= stageNow.w - 28 - 2 && fw.width <= stageNow.w + 1, `Fit width fills the width (${fw.width.toFixed(0)} of ${stageNow.w.toFixed(0)})`);
  await editor.getByRole("button", { name: "Fit page" }).click();
  await page.waitForTimeout(200);
  const fp = await surfaceBox(page);
  assert.ok(fp.width <= fw.width + 1 && Math.abs(fp.width - area.width) < 3, "Fit page shows the whole page again");
  await zoomIn.click();
  await editor.getByRole("button", { name: /Reset zoom/ }).click();
  assert.equal(await zoomLabel(page), "100%");
  ok("Fit width, Fit page and Reset zoom work");

  // ---- arrows: text ---------------------------------------------------------------------------------
  await selectAt(page, 0.14, 0.31);
  const t0 = await selection(page);
  await page.keyboard.press("ArrowRight");
  const t1 = await selection(page);
  near(t1.x - t0.x, FINE, 0.0007, "ArrowRight moves a fine step");
  near(t1.y, t0.y, 0.0007, "…and only sideways");
  near(t1.w, t0.w, 0.0006, "…without changing the width");
  await page.keyboard.press("Shift+ArrowDown");
  const t2 = await selection(page);
  near(t2.y - t1.y, COARSE * A4_ASPECT, 0.0008, "Shift+ArrowDown moves a coarse step");
  // One run of presses is one undo step.
  await editor.getByRole("button", { name: "Undo" }).click();
  sameBox(await selection(page), t0, 0.0012, "Undo reverses the whole run of presses");
  await editor.getByRole("button", { name: "Redo" }).click();
  sameBox(await selection(page), t2, 0.0012, "Redo brings it back");
  ok("keyboard: arrows move by a fine step, Shift by a coarse step, and one run is one Undo");

  // on-screen arrows, Fine / Coarse
  const stepBtn = editor.getByRole("button", { name: /Step size: fine/ });
  await editor.getByRole("button", { name: "Move left", exact: true }).click();
  const t3 = await selection(page);
  near(t2.x - t3.x, FINE, 0.0007, "the on-screen left arrow moves a fine step");
  await stepBtn.click();
  await editor.getByRole("button", { name: "Move up", exact: true }).click();
  const t4 = await selection(page);
  near(t3.y - t4.y, COARSE * A4_ASPECT, 0.0008, "after choosing Coarse the up arrow moves a coarse step");
  await editor.getByRole("button", { name: /Step size: coarse/ }).click();
  ok("on-screen arrows move by the same steps, and Fine / Coarse switches between them");

  // steps are measured on the page, not on the screen: zoomed in they move the same
  const zoomedFrom = await selection(page);
  await zoomIn.click();
  await zoomIn.click();
  const sBefore = await viewportScroll(page);
  await editor.getByRole("button", { name: "Move right", exact: true }).click();
  const zoomedTo = await selection(page);
  near(zoomedTo.x - zoomedFrom.x, FINE, 0.0007, "the same fine step at 150% zoom");
  const sAfter = await viewportScroll(page);
  assert.ok(Math.abs(sAfter.left - sBefore.left) < 2 && Math.abs(sAfter.top - sBefore.top) < 2, "moving a mark with the arrows does not scroll the page behind it");
  await editor.getByRole("button", { name: /Reset zoom/ }).click();
  await page.keyboard.press("ArrowDown");
  assert.equal((await viewportScroll(page)).top, 0, "the arrow key moved the mark, not the page");
  ok("a step is the same distance on the page at any zoom, and the page behind does not move");

  // stays on the page
  for (let i = 0; i < 70; i++) await page.keyboard.press("Shift+ArrowLeft");
  const edge = await selection(page);
  near(edge.x, 0, 0.003, "the mark stops at the left edge of the page");
  assert.ok(edge.x >= -0.003, "…and never leaves it");
  for (let i = 0; i < 40; i++) await page.keyboard.press("Shift+ArrowRight");
  ok("a mark can be pushed to the page edge and no further");
  // put it back where it belongs, clear of the other items: roughly (0.12, 0.3)
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.waitForTimeout(950);
  const textFinal = await selection(page);

  // typing in the text box does not move the mark
  await editor.getByRole("button", { name: "Edit text" }).click();
  const atTyping = await selection(page).catch(() => null);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowUp");
  assert.equal(atTyping, null, "while typing, the mark shows its text box instead of a selection");
  const typingBox = await editor.getByRole("textbox", { name: "Text" }).boundingBox();
  const surf = await surfaceBox(page);
  near((typingBox.x - surf.x) / surf.width, textFinal.x, 0.003, "arrow keys inside the text box moved the caret, not the text");
  near((typingBox.y - surf.y) / surf.height, textFinal.y, 0.004, "…vertically too");
  await page.keyboard.press("Escape"); // finishes typing only
  assert.equal(await page.getByRole("dialog", { name: /Annotate page/ }).count(), 1, "Escape while typing does not close the editor");
  ok("arrow keys do nothing to the mark while typing in its text box");

  // Escape lets go of the selection without closing anything
  if ((await page.locator('[role="application"] .border-dashed').count()) === 0) await selectAt(page, textFinal.x + 0.02, textFinal.y + 0.01);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator('[role="application"] .border-dashed').count(), 0, "Escape deselects");
  assert.equal(await page.getByRole("dialog", { name: /Annotate page/ }).count(), 1, "…and the editor stays open");
  assert.equal(await editor.getByRole("button", { name: "Move left", exact: true }).isDisabled(), true, "the arrows are greyed out with nothing selected");
  ok("Escape deselects first (the editor stays open); the arrows wait for a selection");

  // ---- arrows: signature and picture --------------------------------------------------------------
  await addSignature(page, signature);
  let g0 = await selection(page);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  let g1 = await selection(page);
  near(g1.x - g0.x, FINE, 0.0007, "signature: ArrowRight");
  near(g1.y - g0.y, FINE * A4_ASPECT, 0.0007, "signature: ArrowDown");
  near(g1.w, g0.w, 0.0006, "signature keeps its width");
  near(g1.h, g0.h, 0.0006, "signature keeps its height (no distortion)");
  await page.waitForTimeout(950);
  for (let i = 0; i < 9; i++) await page.keyboard.press("Shift+ArrowDown");
  const sigFinal = await selection(page);
  near(sigFinal.w, g0.w, 0.0006, "signature width unchanged after many moves");
  await page.keyboard.press("Escape");
  ok("a signature moves by exact steps and keeps its shape");

  await addImage(page, logo);
  const i0 = await selection(page);
  await editor.getByRole("button", { name: "Move right", exact: true }).click();
  await editor.getByRole("button", { name: "Move down", exact: true }).click();
  const i1 = await selection(page);
  near(i1.x - i0.x, FINE, 0.0007, "picture: right arrow");
  near(i1.y - i0.y, FINE * A4_ASPECT, 0.0007, "picture: down arrow");
  near(i1.w, i0.w, 0.0006, "picture keeps its width");
  near(i1.h, i0.h, 0.0006, "picture keeps its height");
  await page.waitForTimeout(950);
  for (let i = 0; i < 9; i++) await page.keyboard.press("Shift+ArrowUp");
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
  const imgFinal = await selection(page);
  near(imgFinal.w, i0.w, 0.0006, "picture width unchanged after many moves");
  near(imgFinal.h, i0.h, 0.0006, "picture height unchanged after many moves");
  ok("a picture moves by exact steps and keeps its shape");

  // ---- the downloaded PDF has them where the editor showed them ------------------------------------
  await finishEditing(page);
  const file = await exportPdf(page, `ux-${label.split(" ")[0].toLowerCase()}.pdf`);
  const pages = await renderPages(file, label.split(" ")[0].toLowerCase());
  assert.equal(pages.length, 2, "page count is unchanged");
  const p1 = pages[0].canvas;
  const text = boxOf(p1, isTextRed);
  // The blue banner at the top of the page is also blue: look only below it.
  const bannerFrac = 0.12;
  const below = createCanvas(p1.width, Math.round(p1.height * (1 - bannerFrac)));
  below.getContext("2d").drawImage(p1, 0, Math.round(p1.height * bannerFrac), p1.width, below.height, 0, 0, p1.width, below.height);
  const rawSig = boxOf(below, isSignatureBlue);
  const sig = rawSig && { ...rawSig, y: bannerFrac + rawSig.y * (1 - bannerFrac), h: rawSig.h * (1 - bannerFrac) };
  const logoBox = boxOf(p1, isPurple);
  assert.ok(text && sig && logoBox, "the text, signature and picture are all in the downloaded PDF");
  // The text's ink sits inside its (slightly larger) selection box.
  assert.ok(text.x >= textFinal.x - 0.012 && text.x <= textFinal.x + 0.03, `text x (export ${text.x.toFixed(3)}, editor ${textFinal.x.toFixed(3)})`);
  assert.ok(text.y >= textFinal.y - 0.012 && text.y <= textFinal.y + textFinal.h, `text y (export ${text.y.toFixed(3)}, editor ${textFinal.y.toFixed(3)})`);
  near(logoBox.x, imgFinal.x, 0.02, "picture x in the PDF");
  near(logoBox.y, imgFinal.y, 0.02, "picture y in the PDF");
  // The signature stroke is inside its selection box, which the nudges moved by a known amount.
  assert.ok(sig.x >= sigFinal.x - 0.012 && sig.x + sig.w <= sigFinal.x + sigFinal.w + 0.012, "signature x-range matches the editor");
  assert.ok(sig.y >= sigFinal.y - 0.012 && sig.y + sig.h <= sigFinal.y + sigFinal.h + 0.012, "signature y-range matches the editor");
  // Moving by arrows really changed where it is: compare with where it was first placed (centre of the page).
  assert.ok(sigFinal.y - g0.y > 0.12, "…and that is far from where it started, so the moves are in the file");
  assert.equal(boxOf(pages[1].canvas, isPurple), null, "nothing leaked onto page 2");
  ok("the downloaded PDF has the text, signature and picture where the arrows put them");

  assert.deepEqual(errors, [], "no console or page errors");
  allErrors.push(...errors);
  await context.close();
}

for (const layout of LAYOUTS) {
  if (only && !layout.label.toLowerCase().startsWith(only)) continue;
  await runLayout(layout);
}
await browser.close();
assert.deepEqual(allErrors, []);
console.log(`\n${passed()} checks passed`);
