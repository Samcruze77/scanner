// Neutral, non-intrusive ad placeholder. Always renders in normal document
// flow (never fixed/absolute/sticky) so it can't cover scanner controls or
// document content, and reserves a fixed height up front to avoid layout
// shift once real ad content is wired in.

export type AdSlotVariant = "top-banner" | "workspace" | "mobile-banner";

const VARIANT_CLASSES: Record<AdSlotVariant, string> = {
  "top-banner": "hidden h-20 w-full sm:flex",
  workspace: "flex h-24 w-full",
  "mobile-banner": "flex h-16 w-full sm:hidden",
};

export function AdSlot({ variant, className }: { variant: AdSlotVariant; className?: string }) {
  return (
    <div
      role="complementary"
      aria-label="Advertisement"
      className={`items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-600 ${VARIANT_CLASSES[variant]} ${className ?? ""}`}
    >
      Advertisement
    </div>
  );
}
