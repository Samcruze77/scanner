# Protect PDF / Protect Word tests

`node tests/protect/run.mjs` (`npm run test:protect`) runs the real code: the QPDF WebAssembly engine,
Web Crypto and the modules the browser loads. `LARGE=1` adds a ~48 MB document.

Independent checks used (the code is never only checked against itself):

| Output | Checked with |
| --- | --- |
| Protected PDF | pdf.js (needs the password, refuses a wrong one), QPDF `--show-encryption` |
| Protected .docx | msoffcrypto-tool (Python, the reference open-source Office decryptor: decrypts to the identical package), LibreOffice (opens with the password, refuses a wrong/no password), `cfb` and `olefile` (container parsers) |

`msoffcrypto-tool` and LibreOffice are optional: without them those checks are skipped with a message.
`tests/protect/lo_open.py` is the LibreOffice helper.

## Microsoft Word result

Reported by the project owner (not run by the automated tests): `tests/protect/out/sample-protected.docx`
(the rich fixture: headings, table, picture, hyperlink, lists, header/footer, two sections, Unicode names) was opened in
Microsoft Word. Word asked for the password, `TestPassword123!` opened it, and all four manual checks below passed.
The Word version and operating system were not recorded. Still untested in Word: a file produced by the live page,
a non-ASCII password, and the ~48 MB document.

## Original note: Microsoft Word could not be run by the automated tests

Word is not available in the automated environment, so **Word compatibility is not proven by these tests.**
The file follows [MS-OFFCRYPTO] Agile Encryption and the same container layout Word writes, and every
independent implementation above accepts it, but Word is the final authority.

Before enabling the Word option in production, do this once on a machine with Microsoft Word:

1. `node tests/protect/make-sample.mjs` and open `tests/protect/out/sample-protected.docx` in Word.
2. Word must show its password prompt. `TestPassword123!` must open it and show the same document as
   `sample-original.docx` (headings, table, picture, link, Unicode names, header/footer, two sections).
3. A wrong password, and cancelling the prompt, must NOT open it.
4. Repeat with a file produced by the live page (a real document, a Unicode password).

The Word option ships **off**. To turn it on set `NEXT_PUBLIC_DOCX_PROTECTION_ENABLED=true` for the build
(Vercel: Project Settings > Environment Variables) and redeploy. To roll it back, unset the variable and
redeploy: the Word option, page, sitemap entry and redirects disappear; Protect PDF is unaffected.

## Measured behaviour (release gate, Word flag still OFF)

Memory and timing of Word protection, measured with `tests/protect/profile.mjs` (clean Node process) and
`tests/protect/profile-browser.mjs` (real Chromium, peak renderer resident memory from `/proc`).

Before the fix, verification used the `cfb` package, which in browsers rebuilds each stream as a plain number
array (about 8x the data): a 47.9 MB document peaked at 1623 MB in Node. Now the encrypted package is written
straight into the output buffer, the container is read back with a zero-copy reader (`utils/protect/cfbReader.ts`),
AES keys are prepared once, and only a Blob is kept after verification.

Node (clean process):

| docx | encrypt | verify | total | peak RSS | extra RSS |
|---:|---:|---:|---:|---:|---:|
| 1 MB | 3.8 s | 3.9 s | 7.8 s | 108 MB | +14 MB |
| 9.9 MB | 4.0 s | 4.1 s | 8.2 s | 136 MB | +24 MB |
| 24.9 MB | 4.4 s | 4.6 s | 9.1 s | 182 MB | +64 MB |
| 47.9 MB | 5.3 s | 5.6 s | 11.0 s | 251 MB | +108 MB |

Chromium (desktop, Linux; click to download-ready, includes encrypt + mandatory verification):

| docx | total | peak renderer RSS | idle page RSS | peak JS heap |
|---:|---:|---:|---:|---:|
| 1.0 MB | 1.6 s | 368 MB | 148 MB | 34 MB |
| 9.9 MB | 1.9 s | 416 MB | 150 MB | 86 MB |
| 24.9 MB | 2.4 s | 470 MB | 150 MB | 115 MB |
| 47.9 MB | 3.1 s | 507 MB | 151 MB | 111 MB |

Going from 1 MB to 48 MB adds about 140 MB, so most of the memory is fixed overhead, not document size. That is the
evidence for keeping the 50 MB limit. It is desktop Chromium evidence only: **no phone or tablet was measured**, so no
mobile limit is claimed. If a device cannot allocate enough memory the run fails cleanly with the "too large for your
browser" message and offers no download.

Passwords: the password is converted to UTF-16LE exactly as [MS-OFFCRYPTO] 2.3.4.11 says, with no normalization.
Verified against msoffcrypto-tool and LibreOffice: plain ASCII, long passwords with symbols, non-ASCII letters
(`Ọlájídé-Adéọlá-ñü-Ωmega`) and astral characters (emoji, musical symbols) all round-trip. The same visible password typed
as precomposed (NFC) and as decomposed (NFD) characters is a DIFFERENT password in every implementation tested, so a
password with accents typed on a keyboard that produces the other form will not open the file. Word's own behaviour
here is unverified.
