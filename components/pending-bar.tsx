"use client";

import { Check, Sparkles, X } from "lucide-react";

/**
 * Small floating review bar pinned near pending AI-drafted content (prose
 * or a freshly generated block). Accept keeps it as ordinary doc content;
 * discard removes it (restoring the replaced passage when there was one).
 */
export function PendingBar({
  onAccept,
  onDiscard,
  label = "Review draft",
}: {
  onAccept: () => void;
  onDiscard: () => void;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-2 border border-blue/30 bg-white px-2.5 py-1.5 shadow-[0_0_0_1px_rgba(9,17,32,0.05),0_1px_2px_rgba(9,17,32,0.05),0_12px_32px_-12px_rgba(5,34,91,0.16)]">
      <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-blue">
        <Sparkles className="h-3 w-3" /> {label}
      </span>
      <button
        type="button"
        onClick={onAccept}
        className="pressable inline-flex items-center gap-1 border border-blue bg-blue px-2.5 py-1 font-body text-xs font-medium text-white transition-colors hover:bg-blue-hover"
      >
        <Check className="h-3.5 w-3.5" /> Accept
      </button>
      <button
        type="button"
        onClick={onDiscard}
        className="pressable inline-flex items-center gap-1 border border-border bg-paper px-2.5 py-1 font-body text-xs font-medium text-text transition-colors hover:bg-bg-alt"
      >
        <X className="h-3.5 w-3.5" /> Discard
      </button>
    </div>
  );
}
