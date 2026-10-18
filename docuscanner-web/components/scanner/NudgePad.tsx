"use client";

// On-screen arrow buttons for placing the selected mark exactly. Always on screen (greyed out until
// something is selected) so the layout never jumps when a mark is selected, and each button is a
// 44 px touch target. The step is a small fixed distance on the PAGE, not on the screen, so a tap moves
// the same amount at every zoom level.

import { Icon, type IconName } from "@/components/ui/icons";

export type NudgeStep = "fine" | "coarse";

const BUTTONS: { dx: -1 | 0 | 1; dy: -1 | 0 | 1; label: string; icon: IconName }[] = [
  { dx: -1, dy: 0, label: "Move left", icon: "arrow-left" },
  { dx: 0, dy: -1, label: "Move up", icon: "arrow-up" },
  { dx: 0, dy: 1, label: "Move down", icon: "arrow-down" },
  { dx: 1, dy: 0, label: "Move right", icon: "arrow-right" },
];

export function NudgePad({
  enabled,
  step,
  fineLabel,
  coarseLabel,
  onStep,
  onMove,
  className = "",
}: {
  enabled: boolean;
  step: NudgeStep;
  fineLabel: string;
  coarseLabel: string;
  onStep: (step: NudgeStep) => void;
  onMove: (dx: -1 | 0 | 1, dy: -1 | 0 | 1) => void;
  className?: string;
}) {
  const button = "flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-300 bg-surface disabled:opacity-40 dark:border-zinc-700";
  return (
    <div role="group" aria-label="Move the selected item" data-assistant-id="annotation-move-pad" className={`flex flex-wrap items-center gap-1 ${className}`}>
      {BUTTONS.map((b) => (
        <button
          key={b.label}
          type="button"
          disabled={!enabled}
          aria-label={b.label}
          title={enabled ? `${b.label} (arrow key)` : "Select an item first, then use these arrows to move it"}
          onClick={() => onMove(b.dx, b.dy)}
          className={button}
        >
          <Icon name={b.icon} size={18} />
        </button>
      ))}
      <button
        type="button"
        disabled={!enabled}
        aria-pressed={step === "coarse"}
        aria-label={step === "coarse" ? `Step size: coarse, ${coarseLabel}. Switch to fine.` : `Step size: fine, ${fineLabel}. Switch to coarse.`}
        title="Fine moves a little each tap; Coarse moves further (Shift + arrow key)"
        onClick={() => onStep(step === "coarse" ? "fine" : "coarse")}
        className={`${button} w-auto min-w-[4.25rem] px-2 text-sm font-medium ${step === "coarse" ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" : ""}`}
      >
        {step === "coarse" ? "Coarse" : "Fine"}
      </button>
    </div>
  );
}
