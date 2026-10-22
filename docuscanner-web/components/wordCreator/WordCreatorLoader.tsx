"use client";

// The editor is loaded on demand (it is a large bundle and needs the browser), so the rest of the site stays light.
import dynamic from "next/dynamic";

const WordCreator = dynamic(() => import("./WordCreator").then((m) => m.WordCreator), {
  ssr: false,
  loading: () => <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>,
});

export function WordCreatorLoader() {
  return <WordCreator />;
}
