"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/ui/icons";

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
        className={`flex min-h-40 w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors disabled:opacity-50 ${
          dragging
            ? "border-blue-600 bg-blue-50 dark:bg-blue-950"
            : "border-zinc-300 bg-surface hover:border-blue-400 hover:bg-hover dark:border-zinc-700"
        }`}
      >
        <span aria-hidden className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
          <Icon name="upload" size={22} />
        </span>
        <span className="text-base font-semibold">{title}</span>
        <span className="muted text-sm">{hint}</span>
      </button>
    </div>
  );
}
