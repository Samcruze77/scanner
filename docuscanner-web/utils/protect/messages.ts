// User-facing copy for Protect PDF problems. Generic on purpose: the codes are
// also what reach analytics, so nothing here may contain filenames, contents or
// passwords.

import { MIN_PASSWORD_LENGTH } from "./protect.ts";

const MESSAGES: Record<string, string> = {
  protect_unsupported_type: "That file type isn't supported. Choose a PDF, a Word document or template (.docx, .docm, .dotx, .dotm), or a JPG, PNG or WebP picture.",
  protect_legacy_doc: "Old .doc files aren't supported. Open it in Word, choose Save As, save it as a .docx document, then protect that file.",
  protect_xml_unsupported: "Word XML files (.xml) can't be password-protected the way Word does it. Open the file in Word, choose Save As, save it as a .docx document, then protect that file.",
  protect_type_mismatch: "That file's contents don't match its file type (for example, a macro-enabled document saved with a .docx name). Open it in Word, save it again in the format you want, then try again.",
  protect_too_large: "That file is too large to protect in the browser. PDFs and pictures can be up to 100 MB, Word documents up to 50 MB.",
  protect_invalid: "That file couldn't be read. It may be damaged or not a real PDF or picture.",
  protect_already_protected:
    "That PDF already has a password or restrictions on it. Remove them first (open it with its password and save an unprotected copy), then protect it here.",
  protect_password_missing: "Enter a password.",
  protect_password_short: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  protect_password_long: "That password is too long. Use 127 bytes or fewer (about 40 characters if you use accented or non-Latin letters).",
  protect_password_mismatch: "The two passwords don't match.",
  protect_cancelled: "Protection cancelled. Your original document is unchanged.",
  protect_timeout: "This is taking too long, so we stopped. Your original file is unchanged. Please try again, or try a smaller file.",
  protect_memory: "This document is too large for your browser to protect reliably. Try a smaller file or another device.",
  protect_unverified: "The protected document could not be verified, so we didn't create a download. Your original file is safe. Please try again.",
  protect_unsupported_browser: "This browser can't do the encryption needed. Try a current version of Chrome, Edge, Firefox or Safari.",
  protect_failed: "We couldn't protect this document. Your original file is unchanged. Please try again.",
};

export function protectErrorMessage(code: string): string {
  return MESSAGES[code] ?? MESSAGES.protect_failed;
}
