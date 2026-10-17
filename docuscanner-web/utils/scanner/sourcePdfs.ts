// Keeps the bytes of PDFs that were opened in the scanner workspace, so that the exported PDF can
// re-use the ORIGINAL pages (text, fonts, vector drawing, embedded pictures) instead of pictures of
// them. Memory only: nothing is stored or sent anywhere, and the registry is emptied when a new scan
// is started. See pdfExport.ts.

const sources = new Map<string, Uint8Array>();

export function registerSourcePdf(bytes: Uint8Array): string {
  const id = crypto.randomUUID();
  sources.set(id, bytes);
  return id;
}

export function getSourcePdf(id: string): Uint8Array | undefined {
  return sources.get(id);
}

export function clearSourcePdfs(): void {
  sources.clear();
}
