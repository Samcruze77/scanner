// User-facing copy for compression failures. Keep these generic: the codes are
// also what reach analytics, so nothing here may contain filenames or content.

const MESSAGES: Record<string, string> = {
  compress_unsupported_type: "That file type doesn't match this tool. Please choose the right kind of file.",
  compress_too_large: "That file is too large to compress in the browser. Please try one under 100 MB.",
  compress_invalid: "That file couldn't be read. It may be damaged or not a real document of this type.",
  compress_password: "That PDF is password-protected. Remove the password first, then try again.",
  compress_failed: "Couldn't compress that file. Please try again, or try a different target.",
};

export function compressErrorMessage(code: string): string {
  return MESSAGES[code] ?? MESSAGES.compress_failed;
}
