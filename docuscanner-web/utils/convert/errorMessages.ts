// User-facing copy for spreadsheet conversion failures. Keep these generic --
// the codes are also what gets passed to trackError, so nothing sensitive
// (filenames, cell contents) belongs in either.

const EXCEL_ERROR_MESSAGES: Record<string, string> = {
  excel_unsupported_type: "That file type isn't supported. Please choose an Excel (.xlsx) or CSV file.",
  excel_legacy_xls:
    "Older .xls files aren't supported. Open it in Excel and use Save As to save it as .xlsx, then try again.",
  excel_too_large: "That file is too large. Please use a spreadsheet under 15MB.",
  excel_too_many_rows: "That spreadsheet has too many rows to convert here. Try selecting fewer sheets, or split it up.",
  excel_unreadable: "That file couldn't be read. It may be damaged, password-protected, or not a real spreadsheet.",
  excel_no_data: "That spreadsheet doesn't have any data to convert.",
};

export function excelErrorMessage(code: string): string {
  return EXCEL_ERROR_MESSAGES[code] ?? "Couldn't convert that file. Please try again.";
}

const WORD_ERROR_MESSAGES: Record<string, string> = {
  word_unsupported_type: "That file type isn't supported. Please choose a Word (.docx) file.",
  word_legacy_doc:
    "That looks like an older .doc file or a password-protected document. Open it in Word, remove any password, use Save As to save it as .docx, then try again.",
  word_too_large: "That document is too large. Please use one under 15MB.",
  word_invalid: "That file isn't a valid Word (.docx) document.",
  word_unreadable: "That document couldn't be read. It may be damaged.",
  word_empty: "That document doesn't have any text or pictures to convert.",
  word_failed: "Couldn't convert that document. Please try again.",
};

export function wordErrorMessage(code: string): string {
  return WORD_ERROR_MESSAGES[code] ?? WORD_ERROR_MESSAGES.word_failed;
}
