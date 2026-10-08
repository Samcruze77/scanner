import Image from "next/image";

// The FreePDFScanner brand, on a transparent background. The artwork comes in two colourways
// derived from the supplied logo (files in public/brand): navy wordmark for the Light and Soft
// Gray themes, white wordmark for the Dark theme. Both are in the markup and the theme picks
// one with `dark:` utilities (the same mechanism the rest of the app uses); the hidden ones
// are display:none and lazy, so the browser downloads only the visible image and the link has
// exactly one accessible name. next/image resizes each file per device.
//
// Below 480px the header has no room for the wordmark next to the Log in / Sign up buttons,
// so it shows just the mark there; from 480px up it shows the full lockup. `variant="full"`
// (footer) always shows the lockup.
type Variant = "responsive" | "full";

const ALT = "FreePDFScanner logo";

function Mark({ theme, responsive }: { theme: "light" | "dark"; responsive: boolean }) {
  const show = theme === "light" ? "dark:hidden" : "hidden dark:block";
  const narrowOnly = responsive ? "min-[480px]:hidden!" : "hidden!";
  return (
    <Image
      src={`/brand/logo-mark-${theme}.png`}
      alt={ALT}
      width={44}
      height={44}
      className={`h-11 w-11 shrink-0 ${show} ${narrowOnly}`}
    />
  );
}

function Lockup({ theme, responsive }: { theme: "light" | "dark"; responsive: boolean }) {
  const show = theme === "light" ? "dark:hidden" : "hidden dark:block";
  const wideOnly = responsive ? "max-[479px]:hidden!" : "";
  return (
    <Image
      src={`/brand/logo-horizontal-${theme}.png`}
      alt={ALT}
      width={181}
      height={44}
      className={`h-11 w-auto shrink-0 ${show} ${wideOnly}`}
    />
  );
}

export function Logo({ variant = "responsive" }: { variant?: Variant }) {
  const responsive = variant === "responsive";
  return (
    <>
      {responsive && <Mark theme="light" responsive />}
      {responsive && <Mark theme="dark" responsive />}
      <Lockup theme="light" responsive={responsive} />
      <Lockup theme="dark" responsive={responsive} />
    </>
  );
}
