"use client";

// The editor is loaded on demand (it is a large bundle and needs the browser), so the rest of the site stays light.
import dynamic from "next/dynamic";

const WordCreator = dynamic(() => import("./WordCreator").then((m) => m.WordCreator), {
  ssr: false,
  loading: () => (
    <p role="status" className="text-sm text-zinc-500 dark:text-zinc-400">
      Loading…
    </p>
  ),
});

// The wrapper holds about the editor's height (toolbar plus the first page) through every
// loading step (the code, then "Opening your page…"), so the explanation under it does not
// jump when the editor appears. Without it the page shifted by a CLS of 0.27-0.35.
export function WordCreatorLoader() {
  return (
    <div className="min-h-[1038px]">
      <WordCreator />
    </div>
  );
}
