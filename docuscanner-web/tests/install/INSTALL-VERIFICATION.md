# Install feature: final verification (production build, 2026-10-17)

Feature commit: `c407391` (plus the later PDF-crop commit `3b130bd`; one small follow-up in this verification adds the "not checked on every real device" note to the guide). Script: `node tests/install/verify-final.mjs` against `next start` of the production build. Results: **PASS 35, FAIL 0, NOT TESTED 3**.

"SIMULATED" means a dispatched `beforeinstallprompt` / `appinstalled` event, not a real native install. A real install was never performed.

| Result | Area | Item | Evidence / reason |
|---|---|---|---|
| PASS | 1 PWA | manifest is served as a web manifest and linked from the page | application/manifest+json |
| PASS | 1 PWA | name and short name | FreePDFScanner - Free document scanning / FreePDFScanner |
| PASS | 1 PWA | start_url, scope, id and standalone display are valid and consistent |  |
| PASS | 1 PWA | every manifest icon loads, is a real PNG, and has the size it declares | /brand/icon-192.png 192x192 any; /brand/icon-512.png 512x512 any; /brand/icon-maskable-512.png 512x512 maskable |
| PASS | 1 PWA | apple-touch-icon and favicon links resolve | apple-touch-icon 180x180 |
| PASS | 1 PWA | no other asset referenced by the manifest or head is missing | 20 head assets all 200 |
| PASS | 1 PWA | start URL opens the FreePDFScanner home page | FreePDFScanner - Free document scanning |
| PASS | 1 PWA | no service worker, and no claim of offline support in the site or the manifest | 11 chunks, 0 register calls; 0 offline mentions on the site (all negative) |
| PASS | 1 PWA | Chrome's installability check (CDP Page.getInstallabilityErrors) reports no errors | manifest /manifest.webmanifest, 0 installability errors |
| NOT TESTED | 1 PWA | the installed app (own window) opens the right page | no browser was actually installed here; the start URL, scope and standalone rules above were checked instead, and the page was exercised in standalone display mode below |
| PASS | 2 Reminders | a successful download triggers the completion reminder (real scan -> PDF -> Download) |  |
| PASS | 2 Reminders | a failed conversion does not trigger it | error shown: That file couldn't be read. It may be damaged, password-prot |
| PASS | 2 Reminders | 'Not yet' gives no install invitation, and none later on that page or after a reload |  |
| PASS | 2 Reminders | 'Maybe later': stored period is right and survives navigation and a reload | 14 days, returns after expiry |
| PASS | 2 Reminders | 'close': stored period is right and survives navigation and a reload | 7 days, returns after expiry |
| PASS | 2 Reminders | 'Don't remind me again': stored period is right and survives navigation and a reload | permanent |
| PASS | 2 Reminders | browsing reminder does not appear too early (30 s) and does appear after a minute of use |  |
| PASS | 2 Reminders | unfinished-task reminder offers help, not installation |  |
| PASS | 2 Reminders | only one reminder at a time |  |
| PASS | 2 Reminders | held back by the cookie banner until a choice is made |  |
| PASS | 2 Reminders | held back while the Ask me panel is open |  |
| PASS | 2 Reminders | held back while the page editor is open, shown after it closes (real editor) |  |
| PASS | 2 Reminders | card stays clear of ads, bottom navigation, Ask me and controls while scrolling (desktop) | 7 visible / 0 hidden-while-covering samples, no overlap |
| PASS | 2 Reminders | card stays clear of ads, bottom navigation, Ask me and controls while scrolling (phone 390x844) | 13 visible / 0 hidden-while-covering samples, no overlap |
| PASS | 2 Reminders | installed app: not asked again (standalone display, iOS standalone flag, and appinstalled) |  |
| PASS | 2 Reminders | storage holds only the intended preferences; nothing about reminders is sent to analytics | local ds_session_last_seen,ds_consent,ds_install_reminder,ds_visitor_id; session ds_session_id; reminder {"v":1,"quietUntil":1793485260694,"dismissals":1}; 2 ordinary analytics requests, none about reminders |
| PASS | 3 Prompt | real Chrome: is the native prompt offered here? (reported as observed) | beforeinstallprompt did NOT fire in this automated Chrome (headless/automation never offers it) |
| PASS | 3 Prompt | SIMULATED event: not invoked before a click; accepted state does not claim success | simulation, not a native install |
| PASS | 3 Prompt | SIMULATED event: dismissed -> polite, quiet for 14 days | simulation |
| PASS | 3 Prompt | SIMULATED event: prompt() throws -> falls back to the manual guide, no success claimed | simulation |
| PASS | 3 Prompt | no prompt available (Safari, iPhone, Firefox style): the manual guide opens, and opening it claims nothing |  |
| NOT TESTED | 3 Prompt | a real native install and the real `appinstalled` event | needs a headed browser with a person accepting the operating-system install dialog; automation never receives beforeinstallprompt. `appinstalled` handling was only exercised with a dispatched event |
| PASS | 4 Guide | iPhone Safari: right steps, uncertainty stated, a fallback when the option is missing |  |
| PASS | 4 Guide | Android Chrome: right steps, uncertainty stated, a fallback when the option is missing |  |
| PASS | 4 Guide | Windows Edge: right steps, uncertainty stated, a fallback when the option is missing |  |
| PASS | 4 Guide | macOS Safari: right steps, uncertainty stated, a fallback when the option is missing |  |
| PASS | 4 Guide | unsupported browser: right steps, uncertainty stated, a fallback when the option is missing |  |
| NOT TESTED | 4 Guide | the steps on real devices and browser versions | no iPhone, iPad, Android phone, Samsung device, Mac or Firefox install flow was available; wording comes from the vendors' help pages (listed in the dialog) |

## Findings worth stating plainly
- **Chrome's own installability check passes** on the production build (CDP `Page.getInstallabilityErrors`: 0 errors, in a normal non-incognito profile). The first run reported `in-incognito` only because Playwright's default context is incognito; that was a test setup problem, not a site problem.
- **Chrome did not offer the native prompt in this automated browser**, which is normal for automation. So "the prompt is offered" is NOT TESTED for real; the click-only, accepted, dismissed and unavailable handling was verified with simulated events and is labelled that way.
- **No offline claim.** There is no service worker (`/sw.js` 404, no `serviceWorker.register` in any served chunk), the manifest does not mention offline, and the only "offline" wording on the site is the guide's "does not work offline". (An earlier false alarm on the privacy page, "No internet-based service can guarantee...", was a too-broad pattern in the test.)
- **Reminders** only follow a saved file (a failed Excel conversion produced no card), are one at a time, wait for dialogs including the cookie banner, the Ask me panel and the page editor, and never overlapped an ad, the bottom bar, Ask me or a control across 20 scroll positions on desktop and phone (the card hides itself while covering something).
- **Storage**: one reminder key (`ds_install_reminder`: `v`, `quietUntil`, `dismissals`, `off`, `helpQuietUntil`, `helpDismissals`), no cookies, no IndexedDB, and with analytics switched ON none of the analytics requests mention the reminders.
- **Guide**: every device/browser combination has a bookmark fallback and a "can't find it" section; the manual device/browser selector is kept; a new line in every guide says the steps follow the browser makers' help pages and have not been checked on every version on a real device.

## Not verified (honest limits)
- Real native installation and the real `appinstalled` event (needs a person and a headed browser).
- The installed app in its own window (only the start URL, scope and standalone display rules were exercised).
- All guide steps on real iPhone, iPad, Android, Samsung Internet, Mac Safari and Firefox devices.

## Regression run (same build)
Install unit 71, install browser 56, assistant unit 19 + 17, assistant browser 31, launcher 16, images unit 15 + 4, images e2e 27, images quality 11, PDF quality 18 + 18: all pass. Consent 65 passed, 1 failed (the documented failure on the clean base commit). Type check clean; lint 0 errors (17 existing warnings); production build succeeds.
