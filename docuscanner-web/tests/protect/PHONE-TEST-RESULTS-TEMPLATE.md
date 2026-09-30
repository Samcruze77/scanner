# Protect Word: phone test results

Fill in only what you actually saw. Write `Unknown` if you did not observe it and `Not tested` if you skipped it.
Procedure: `tests/protect/MANUAL-VALIDATION.md`, section 1. One copy of this form per device.

## Device

- Tester name (optional):
- Date:
- Page tested (URL of the staging/preview build):
- Device model:
- OS and version:
- Browser and version:
- Word app and version:
- Network (Wi-Fi / mobile data):

## Test A: small document (`small.docx`, about 55 KB)

| Step | Expected | What happened | Pass / Fail |
|---|---|---|---|
| Page opens with no sign-in prompt | no sign-in | | |
| Choose file | file name shown | | |
| Tap Protect with empty passwords | "Enter a password." and nothing starts | | |
| Passwords that do not match | "The two passwords don't match." | | |
| Protect with `TestPassword123!` | progress, then "Your Word document is protected" | | |
| Time from tapping Protect to "protected" (seconds) | any | | |
| Download | `small-protected.docx` saved | | |
| Open in Word app | Word asks for a password | | |
| Wrong password | refused | | |
| Correct password | opens; same content as `small.docx` (headings, table, picture, link, header/footer, Unicode names) | | |
| Close and reopen the file | password asked again | | |
| Choose a non-.docx file (for example .txt) | clear message, no download | | |
| Choose `small.docx` again without reloading | works | | |
| Original `small.docx` unchanged | unchanged | | |

## Test B: about 10 MB document (`10mb.docx`, 9.88 MB). Skip if the phone is low on memory.

| Question | Answer |
|---|---|
| Tested? (yes / no, and why not) | |
| File size | |
| Time from tapping Protect to "protected" (seconds) | |
| Protection succeeded? | |
| Download offered? | |
| Word opened it with the correct password? | |
| Wrong password rejected? | |
| Did the tab reload, freeze, crash, or show a "too large" message? (describe exactly) | |
| Any out-of-memory, timeout or error message? (copy the text) | |

## Test C (optional): accented password

Password used (for example `Pässwörd-Ọlájídé-ñ-2024`; say `Not tested` if you could not type it):

| Step | Result |
|---|---|
| Protect succeeded | |
| Word accepted the correct password | |
| Word rejected a wrong password | |
| Password asked again after reopening | |

## Anything unexpected

(Screenshots or the exact text of any message are the most useful.)

## Summary (for the release gate)

- Protection succeeded on this device:  yes / no / partly
- Word opened the result:  yes / no / not tested
- Wrong password rejected:  yes / no / not tested
- Any memory, timeout or crash problem:  none / describe
