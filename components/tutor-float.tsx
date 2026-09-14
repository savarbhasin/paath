"use client";

import { useState } from "react";
import { Minus, Sparkles, X } from "lucide-react";

import { TutorPanel } from "@/components/tutor-panel";
import type { NotebookSelection } from "@/components/notebook-editor";
import type { Notebook } from "@/lib/domain";
import { cn } from "@/lib/utils";

/**
 * Floating-only tutor for the notebook page. A small circular icon button
 * sits fixed at the bottom-right, clear of the editor text; pressing it
 * opens the conversation as a floating window anchored bottom-right, so the
 * notebook stays visible and editable behind it. Minimizing collapses back
 * to just the circle; closing unmounts the panel (the thread reloads from
 * the server routes on reopen). Streaming, citations, the selection chip,
 * and the seed-question mechanism all live in TutorPanel unchanged.
 */
export function TutorFloat({
  courseId,
  notebook,
  selection,
}: {
  courseId: string;
  notebook: Notebook;
  selection: NotebookSelection;
}) {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);

  return (
    <>
      {!open || minimized ? (
        <button
          type="button"
          onClick={() => {
            setMinimized(false);
            setOpen(true);
          }}
          aria-label="Open tutor chat"
          title="Ask the tutor"
          className="pressable allow-round fixed bottom-6 right-6 z-40 flex h-11 w-11 items-center justify-center border border-blue bg-blue text-white shadow-[0_0_0_1px_rgba(9,17,32,0.05),0_1px_2px_rgba(9,17,32,0.05),0_12px_32px_-12px_rgba(5,34,91,0.16)] transition-colors hover:bg-blue-hover"
        >
          <Sparkles className="h-5 w-5" />
        </button>
      ) : null}

      {open ? (
        <div
          role="dialog"
          aria-label="Tutor conversation"
          className={cn(
            "fixed bottom-4 right-4 z-50 flex max-h-[min(640px,calc(100vh-2rem))] w-[min(430px,calc(100vw-2rem))] flex-col border border-border bg-white shadow-[0_0_0_1px_rgba(9,17,32,0.05),0_1px_2px_rgba(9,17,32,0.05),0_12px_32px_-12px_rgba(5,34,91,0.16)]",
            minimized && "hidden",
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <div>
              <p className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-blue">
                <Sparkles className="h-3.5 w-3.5" /> Tutor
              </p>
              <p className="mt-0.5 font-heading text-sm font-medium tracking-[-0.01em] text-text">Ask your material</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMinimized(true)}
                className="pressable p-1.5 text-text-dim hover:text-text"
                aria-label="Minimize tutor chat"
              >
                <Minus className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="pressable p-1.5 text-text-dim hover:text-text"
                aria-label="Close tutor chat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <TutorPanel
            key={`tutor-${courseId}-${notebook.id}`}
            courseId={courseId}
            notebook={notebook}
            selection={selection}
            hideHeader
          />
        </div>
      ) : null}
    </>
  );
}
