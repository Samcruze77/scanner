// A one-shot, in-memory hand-off of files from a converter tool to the scan
// workspace, so a freshly converted PDF can be opened for editing and signing
// with one click. It lives only in this browser tab's memory: nothing is
// uploaded, stored or logged, and it is emptied the moment the workspace takes it.

let pending: File[] = [];

export function setPendingImport(files: File[]): void {
  pending = files;
}

export function takePendingImport(): File[] {
  const files = pending;
  pending = [];
  return files;
}
