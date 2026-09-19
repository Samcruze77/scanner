"use client";

import { useRef, useState } from "react";

// Click-or-drop file picker shared by the conversion tools. The visible
// control is a real button (keyboard and screen-reader friendly) that opens a
// hidden file input; dropping a file anywhere on it works too.
export function FileDropzone({
  accept,
  title,
  hint,
  disabled,
  onFile,
}: {
  accept: string;
  title: string;
  hint: string;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        if (disabled) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file && !disabled) onFile(file);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        aria-label={title}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // allow choosing the same file again
          if (file) onFile(file);
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className={`flex min-h-40 w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors disabled:opacity-50 ${
          dragging
            ? "border-zinc-900 bg-zinc-100 dark:border-white dark:bg-zinc-900"
            : "border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
        }`}
      >
        <span className="text-base font-semibold">{title}</span>
        <span className="text-sm text-zinc-500">{hint}</span>
      </button>
    </div>
  );
}
