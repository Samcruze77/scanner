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

## What has NOT been tested: Microsoft Word itself

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
