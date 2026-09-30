# Manual validation: Protect Word on phones and in Microsoft Word

These checks need real devices and real Microsoft Word, which the automated tests cannot provide. Do them
against a **staging or preview deployment built with `NEXT_PUBLIC_DOCX_PROTECTION_ENABLED=true`**. The production
flag stays off until every check below is recorded as passed. Record only what actually happened; write
`Unknown` for anything you did not observe.

## 0. Prepare the files (on a computer with this repository)

```text
node tests/protect/make-manual-fixtures.mjs        # writes tests/protect/out/manual/
```

| File | Size | Use |
|---|---|---|
| `small.docx` | about 55 KB | every device; a rich document (headings, table, picture, link, lists, header/footer, two sections, Unicode names) |
| `10mb.docx` | about 9.9 MB | phones with enough memory |
| `48mb.docx` | about 47.5 MB | desktop; phones only if you choose to (see the warning) |
| `SHA256SUMS.txt` | | checksums, to prove the original is unchanged afterwards |

Also use one **real document of your own** for the desktop live-page test (section 2).

Copy the files to the phone (AirDrop, USB, cloud drive). Keep the originals on the computer.

Passwords to use (type them; do not paste a password that hides a typo):

| Category | Password |
|---|---|
| ASCII | `TestPassword123!` |
| Accented | `Pässwörd-Ọlájídé-ñ-2024` |
| Beyond Latin-1 | `密码-пароль-🔐-Ωmega` |

On a phone, typing the third one may be awkward; if you cannot type it, write `not tested` for that row rather than substituting another password.

## 1. Phones

### iPhone (Safari + Word / Microsoft 365 app)

1. In Safari, open the **deployed Protect Word page**: `https://<your-staging-host>/tools/protect-word`. Note the iOS version (Settings > General > About) and the model.
2. Confirm no sign-in prompt appears and the page says your file stays on your device.
3. Tap the file area and choose `small.docx` from Files.
4. Tap **Protect Word document** with the password fields empty. **Expect** "Enter a password." and no progress. Type `TestPassword123!` in the first field and a different text in the second. **Expect** "The two passwords don't match." Fix both.
5. Tap **Protect Word document**. **Expect** a progress bar, then "Your Word document is protected". Note roughly how long it took.
6. Tap **Download protected Word document**. Save it to Files. **Expect** the name `small-protected.docx`.
7. Open the saved file in the **Word app** (Files > share > Word, or open Word > Open). Note the Word app version.
8. **Expect** Word asks for a password. Enter a **wrong** password. **Expect** it refuses. Enter `TestPassword123!`. **Expect** the document opens with the same content as `small.docx` (headings, table, picture, link, header/footer, the Unicode names).
9. Close Word, reopen the same file. **Expect** the password is required again.
10. Back in Safari, protect the same file again with a **new** password and confirm the second download is the new file (open it with the new password only).
11. Try **Retry after failure**: choose a file that is not a .docx (for example a .txt) and confirm a clear message and no download; then choose `small.docx` again and confirm it still works without reloading.
12. Confirm the original `small.docx` in Files is unchanged (open it, or compare the checksum on a computer).
13. Repeat steps 3–9 with `10mb.docx` if the phone has enough free memory. Note the elapsed time. **Warning:** if the browser tab reloads, freezes or shows "a problem occurred", stop, record exactly that, and do not retry larger files. The page must then show its "too large for your browser" message or nothing; it must never offer a download that does not open.

### Android (Chrome + Word app)

Same steps as iPhone, with: Chrome, **Download** as the save location, and the Microsoft Word app (Files > open with Word). Note the device model, Android version, Chrome version and Word app version. A downloaded file may appear in the notification shade; open it from there or from the Files app.

## 2. Desktop: live page to Microsoft Word

Do this once per password category (ASCII, accented, beyond Latin-1), using your own real `.docx`:

1. Open the deployed Protect Word page in a desktop browser. Note the browser and version.
2. Select the real document. Note the original file's checksum (`shasum -a 256 file.docx` or `certutil -hashfile file.docx SHA256`).
3. Enter the password twice and protect. Download the result.
4. (Optional but useful) check the download against the original with this repository's checker:
   `node tests/protect/check-download.mjs original.docx downloaded-protected.docx "the password"`. It decrypts and compares byte-for-byte and tries a wrong and an empty password. It proves the file is a correct copy; it does not replace Word.
5. Open the downloaded file in desktop **Microsoft Word**. Note Word's version (File > Account) and the operating system.
6. **Expect** the password prompt. Enter the correct password. **Expect** the document opens and is identical to the original.
7. Close Word. Reopen the same file. **Expect** the password is still required.
8. Enter a wrong password. **Expect** refusal. Cancel the prompt / leave it blank. **Expect** the document does not open.
9. Re-check the original's checksum. **Expect** it is unchanged.

If Word behaves differently from LibreOffice or msoffcrypto-tool for any password, Word is the reference: stop and report the exact behaviour before release.

## 3. Large document (about 48 MB)

On desktop, through the deployed page, protect `48mb.docx` (47.5 MB). Record the exact size, browser, elapsed time, whether the download was offered, and whether Word opened the result with the password. A desktop success says nothing about phones.

## 4. Results (fill in only what you observed)

### Word record

| Date | Word version | OS | Browser (live page) | Source of protected file | File size | Password category | Correct password | Wrong password | Missing password | Reopen |
|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | |

### Phone record

| Date | Device model | OS version | Browser + version | Word app + version | File size | Elapsed | Protection succeeded | Word opened it | Wrong password rejected | OOM / timeout / error |
|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | |
