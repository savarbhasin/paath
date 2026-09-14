"use client";

import { useId, useState } from "react";
import { AlertCircle, ArrowRight, LoaderCircle, Sparkles, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import type { ArtifactEnvelope } from "@/lib/contracts";
import { parseArtifactEnvelope, type ApplyOperationResult } from "@/lib/editor-operations";
import type { EditorOperationInput } from "@/lib/tutor";

export type InlineAskKind = "explanation" | "mermaid" | "image";
export type InlineAskMode = "insert_after" | "replace_selection";

export type InlineAskContext = {
  mode: InlineAskMode;
  anchorNodeId?: string;
  replacementRange?: { from: number; to: number };
  /** Trimmed selected text (empty for caret/insert-after). Never written until generation validates. */
  selectedText: string;
};

export type InlineApplyOutcome = ApplyOperationResult & {
  saved?: boolean;
  message?: string;
};

const KIND_LABEL: Record<InlineAskKind, string> = {
  explanation: "Explanation",
  mermaid: "Diagram",
  image: "Image",
};

/**
 * One unified inline generation box. Cursor state (not a picker) decides the
 * operation: caret/empty-line callers pass `insert_after`, selection callers
 * pass `replace_selection`. All three kinds go through the existing
 * `/api/generate` planner — no parallel routes — and the result is handed to
 * the caller for insertion through the existing editor apply contract, so
 * artifact hydration, version-conflict, and per-block controls keep working.
 *
 * Replace is non-destructive until validation: the document is only touched
 * inside `onApply` after the artifact parses, so a failed generation leaves
 * the original selection intact and the box stays open with the error.
 */
export function InlineAskBox({
  context,
  courseId,
  notebookId,
  getVersion,
  onApply,
  onClose,
  onInserted,
  explanationLocked,
}: {
  context: InlineAskContext;
  courseId: string;
  notebookId: string;
  getVersion: () => number;
  onApply: (
    kind: "explanation" | "visual",
    operation: EditorOperationInput,
    artifact: ArtifactEnvelope,
  ) => Promise<InlineApplyOutcome>;
  onClose: () => void;
  onInserted?: (message: string) => void;
  /** One explanation draft at a time — set while a pending insert awaits review. */
  explanationLocked?: boolean;
}) {
  const promptId = useId();
  const [prompt, setPrompt] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReplace = context.mode === "replace_selection";
  const submit = async () => {
    if (isBusy) return;
    const topic = prompt.trim() || context.selectedText.slice(0, 120);
    if (!topic) {
      setError("Describe what to generate first.");
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      const operation: EditorOperationInput = {
        operation: context.mode,
        expectedNotebookVersion: getVersion(),
        ...(context.mode === "insert_after" && context.anchorNodeId
          ? { anchorNodeId: context.anchorNodeId }
          : {}),
        ...(context.mode === "replace_selection" && context.replacementRange
          ? { replacementRange: context.replacementRange }
          : {}),
      };
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...operation,
          courseId,
          notebookId,
          kind: "auto",
          explanationLocked: explanationLocked === true,
          topic,
          title: topic.slice(0, 120),
          selectedText: context.selectedText || null,
        }),
      });
      const payload = (await response.json()) as {
        artifact?: unknown;
        operation?: EditorOperationInput;
        status?: string;
        error?: string;
        currentVersion?: number;
      };
      if (response.status === 409) {
        throw new Error(payload.error ?? "The notebook changed. Close and try again from the current selection.");
      }
      // Visual failures (502) still carry the persisted failed artifact plus
      // the operation so the browser can insert an isolated failed block.
      if (!payload.artifact || !payload.operation) {
        throw new Error(payload.error ?? "The response could not be generated. Nothing was changed.");
      }
      let artifact: ArtifactEnvelope;
      try {
        artifact = parseArtifactEnvelope(payload.artifact);
      } catch {
        throw new Error("The response came back invalid. Nothing was changed. Try again.");
      }
      if (artifact.kind !== "explanation" && artifact.kind !== "mermaid" && artifact.kind !== "image") {
        throw new Error("The response has an unsupported format. Nothing was changed.");
      }
      const kind = artifact.kind;
      const outcome = await onApply(
        kind === "explanation" ? "explanation" : "visual",
        payload.operation,
        artifact,
      );
      if (!outcome.ok) {
        throw new Error(`${outcome.error ?? "The insert failed."} Nothing was removed.`);
      }
      if (payload.status === "failed") {
        throw new Error(payload.error ?? `The ${KIND_LABEL[kind].toLowerCase()} failed. A failed block was kept with its own Retry.`);
      }
      onInserted?.(outcome.message ?? `${KIND_LABEL[kind]} inserted.`);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "The generation failed. Nothing was changed.");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div role="dialog" aria-label="Ask AI" className="border border-border bg-white p-2 shadow-lg">
      <div className="flex items-center gap-2">
        <Sparkles className="ml-1 h-4 w-4 shrink-0 text-blue" />
        <Input
          id={promptId}
          autoFocus
          value={prompt}
          maxLength={200}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={isReplace ? "Ask AI to change this selection..." : "Ask AI anything..."}
          aria-label="Ask AI prompt"
          className="min-w-0 border-0 bg-transparent shadow-none"
          disabled={isBusy}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
            if (event.key === "Escape" && !isBusy) {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <button type="button" disabled={isBusy} onClick={() => void submit()}
          aria-label="Send prompt" className="pressable bg-blue p-2 text-white transition-colors hover:bg-blue-hover disabled:opacity-50">
          {isBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
        </button>
        <button type="button" onClick={onClose} disabled={isBusy} aria-label="Close Ask AI"
          className="pressable p-1 text-text-dim hover:text-text disabled:opacity-50">
          <X className="h-4 w-4" />
        </button>
      </div>
      {explanationLocked ? <p className="px-2 pt-2 text-xs text-text-muted">Accept or discard the pending draft before asking for more text.</p> : null}
      {error ? <p role="alert" className="flex items-start gap-2 px-2 pt-2 text-xs text-[#93443d]">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
      </p> : null}
    </div>
  );
}
