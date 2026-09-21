// The PDFScanner mark and wordmark. The wordmark is hidden on very small screens,
// where the mark alone keeps the header from crowding.
export function Logo({ showWordmark = true }: { showWordmark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 3h7l5 5v13H7z" />
          <path d="M10 13h6M10 17h6" />
        </svg>
      </span>
      {showWordmark && <span className="hidden text-base font-semibold tracking-tight sm:inline">PDFScanner</span>}
    </span>
  );
}
