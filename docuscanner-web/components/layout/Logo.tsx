import Image from "next/image";

// The FreePDFScanner brand. The artwork is black-backed with white wordmark text, so it is
// served as a self-contained dark tile that stays legible on every theme's chrome (Light,
// Soft Gray and Dark) without touching the theme palette. Files live in public/brand and are
// derived from the supplied logo; next/image resizes them per device.
//
// Below 480px the header has no room for the wordmark next to the Log in / Sign up buttons,
// so the tile shows just the mark there; at 480px and up it shows the full lockup. Only one
// of the two is ever rendered by the browser (the other is display:none), so the link has
// exactly one accessible name. `variant="mark"` pins the mark for tight spots.
export function Logo({ variant = "responsive" }: { variant?: "responsive" | "full" | "mark" }) {
  const showMark = variant !== "full";
  const showFull = variant !== "mark";
  return (
    <>
      {showMark && (
        <Image
          src="/brand/logo-mark.png"
          alt="FreePDFScanner logo"
          width={44}
          height={44}
          className={`h-11 w-11 shrink-0 rounded-lg ${variant === "responsive" ? "min-[480px]:hidden" : ""}`}
        />
      )}
      {showFull && (
        <Image
          src="/brand/logo-horizontal.png"
          alt="FreePDFScanner logo"
          width={168}
          height={44}
          className={`h-11 w-auto shrink-0 rounded-lg ${variant === "responsive" ? "hidden min-[480px]:block" : ""}`}
        />
      )}
    </>
  );
}
