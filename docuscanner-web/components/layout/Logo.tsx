// The PDFScanner mark and wordmark. The wordmark is shown at every width, including
// mobile, so the app is identifiable at a glance there too -- just a size smaller than
// on desktop to keep the header compact. `showWordmark` still exists for a spot (e.g. a
// tight admin nav) that wants the mark on its own.
export function Logo({ showWordmark = true }: { showWordmark?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 3h7l5 5v13H7z" />
          <path d="M10 13h6M10 17h6" />
        </svg>
      </span>
      {showWordmark && (
        <span className="truncate text-sm font-semibold tracking-tight sm:text-base">PDFScanner</span>
      )}
    </span>
  );
}
