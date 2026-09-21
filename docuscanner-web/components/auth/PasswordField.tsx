"use client";

// The one password input used everywhere in the app, with a show/hide (eye)
// button inside it.
//  - Masked by default. The button switches the same input between
//    type="password" and type="text", so the value is never touched, copied or
//    re-created; turning it off masks it again.
//  - The button is type="button": pressing it can never submit the form.
//  - Pressing it doesn't take focus away from the input (mouse-down is
//    cancelled), and the caret/selection is put back afterwards, so you can keep
//    typing where you were.
//  - 44px touch target, sitting inside the input's right padding so long
//    passwords never run underneath it.

import { useId, useLayoutEffect, useRef, useState } from "react";

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  error,
  hint,
  autoFocus,
  onBlur,
}: {
  // Shown above the field, and used in the button's accessible name.
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  error?: string | null;
  hint?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const localRef = useRef<HTMLInputElement | null>(null);
  // Where the caret was (and whether the field had focus) when the button was pressed.
  const restore = useRef<{ start: number; end: number } | null>(null);

  useLayoutEffect(() => {
    const el = localRef.current;
    const saved = restore.current;
    if (!el || !saved) return;
    restore.current = null;
    // Only take focus if it was lost: calling focus() on a field that already has it
    // makes Chrome re-apply its old cached selection over the one restored below.
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    const apply = () => {
      try {
        el.setSelectionRange(saved.start, saved.end);
      } catch {
        // Some browsers refuse a selection on certain input types; the value is intact regardless.
      }
    };
    apply();
    // Switching the input's type can reset the caret a moment later in some browsers.
    const frame = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  function toggle() {
    const el = localRef.current;
    if (el && document.activeElement === el) {
      restore.current = { start: el.selectionStart ?? el.value.length, end: el.selectionEnd ?? el.value.length };
    }
    setVisible((v) => !v);
  }

  const lower = label.toLowerCase();
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="text-sm">
      <label htmlFor={id} className="mb-1 block text-zinc-600 dark:text-zinc-400">
        {label}
      </label>
      <div className="relative">
        <input
          ref={localRef}
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="password-input field pr-12"
        />
        <button
          type="button"
          onClick={toggle}
          // Keep the caret in the field: a mouse-down would move focus to the button.
          onMouseDown={(e) => e.preventDefault()}
          aria-label={visible ? `Hide ${lower}` : `Show ${lower}`}
          aria-controls={id}
          title={visible ? `Hide ${lower}` : `Show ${lower}`}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-zinc-500 hover:text-zinc-900 focus-visible:text-zinc-900 dark:text-zinc-400 dark:hover:text-white dark:focus-visible:text-white"
        >
          <EyeIcon off={visible} />
        </button>
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
