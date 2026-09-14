"use client";
import { ManageItemButton } from "@/components/manage-item-button";

import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import UniqueID from "@tiptap/extension-unique-id";
import type { JSONContent } from "@tiptap/core";
import { AlertCircle, Bold, ChevronRight, Code2, FolderOpen, Heading2, Italic, Link2, List, ListOrdered, LoaderCircle, RefreshCw, Save, Sparkles } from "lucide-react";
import NextLink from "next/link";

import { InlineAskBox, type InlineAskContext } from "@/components/inline-ask-ai";

import type { Notebook, NotebookDocument } from "@/lib/domain";
import type { ArtifactEnvelope } from "@/lib/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ExplanationArtifactsContext } from "@/components/explanation-artifacts-context";
import { ExplanationNode } from "@/components/explanation-node";
import { FlashcardDeckNode } from "@/components/flashcard-deck-node";
import { AssessmentNode } from "@/components/assessment-node";
import { MermaidNode } from "@/components/mermaid-node";
import { GeneratedImageNode } from "@/components/generated-image-node";
import { PendingBar } from "@/components/pending-bar";
import { PendingMark } from "@/components/pending-mark";
import { ArtifactUpsertContext, type ArtifactWithStatus } from "@/components/generated-artifacts-store";
import {
  acceptPendingExplanation,
  applyExplanationOperation,
  applyStudyOperation,
  applyVisualOperation,
  artifactEnvelopeSchema,
  deleteBlockByArtifactId,
  discardPendingExplanation,
  findBlockPosByArtifactId,
  findPendingDraft,
  insertPendingExplanation,
  type ApplyOperationResult,
} from "@/lib/editor-operations";
import { explanationToTiptapNodes, stripLegacyAttributionNodes } from "@/lib/explanation-prose";
import { explanationPayloadSchema, type EditorOperationInput } from "@/lib/tutor";
import { cn } from "@/lib/utils";

type SaveStatus = "saved" | "saving" | "conflict" | "failed";

type ConflictCopy = {
  notebook: Notebook;
  localVersion: number;
};

export type NotebookSelection = {
  text: string;
  from: number;
  to: number;
  anchorNodeId?: string;
};

export type ApplyExplanationOutcome = ApplyOperationResult & {
  /** Set when the operation applied and the save completed. */
  saved?: boolean;
  message?: string;
};

export type NotebookEditorApi = {
  applyExplanation: (operation: EditorOperationInput, artifact: ArtifactEnvelope) => Promise<ApplyExplanationOutcome>;
  applyVisual: (operation: EditorOperationInput, artifact: ArtifactEnvelope) => Promise<ApplyExplanationOutcome>;
  applyStudy: (operation: EditorOperationInput, artifact: ArtifactEnvelope) => Promise<ApplyExplanationOutcome>;
  getSelection: () => NotebookSelection;
  getVersion: () => number;
};

const editorExtensions = [
  StarterKit,
  Link.configure({ openOnClick: false, autolink: true }),
  UniqueID.configure({
    types: ["paragraph", "heading", "bulletList", "orderedList", "listItem", "blockquote", "codeBlock"],
  }),
  ExplanationNode,
  MermaidNode,
  GeneratedImageNode,
  FlashcardDeckNode,
  AssessmentNode,
  PendingMark,
];

function toolbarButtonClass(active: boolean) {
  return cn(
    "pressable inline-flex h-8 items-center justify-center gap-1.5 border px-2 font-body text-xs font-medium transition-colors",
    active ? "border-blue bg-blue-tint text-blue" : "border-transparent text-text-muted hover:bg-bg-alt hover:text-text",
  );
}

export function NotebookEditor({
  notebook,
  courseId,
  courseTitle,
  onSaved,
  editorApiRef,
  onSelectionChange,
}: {
  notebook: Notebook;
  courseId: string;
  courseTitle: string | null;
  onSaved: (notebook: Notebook) => void;
  editorApiRef?: RefObject<NotebookEditorApi | null>;
  onSelectionChange?: (selection: NotebookSelection) => void;
}) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictCopy | null>(null);
  const [artifacts, setArtifacts] = useState<Map<string, ArtifactEnvelope>>(new Map());
  const versionRef = useRef(notebook.version);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDocumentRef = useRef<NotebookDocument>(notebook.contentJson);
  const editorHolderRef = useRef<ReturnType<typeof useEditor> | null>(null);
  const selectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionCallbackRef = useRef(onSelectionChange);
  useEffect(() => {
    selectionCallbackRef.current = onSelectionChange;
  }, [onSelectionChange]);

  type InlineAffordance = {
    kind: "empty-line" | "selection";
    top: number;
    left: number;
    context: InlineAskContext;
  };

  const [affordance, setAffordance] = useState<InlineAffordance | null>(null);
  const [inlineContext, setInlineContext] = useState<InlineAskContext | null>(null);
  const [inlinePos, setInlinePos] = useState<{ top: number; left: number } | null>(null);
  const [inlineNotice, setInlineNotice] = useState<string | null>(null);
  const [noticeSeq, setNoticeSeq] = useState(0);
  // Freshly generated block (diagram/image/deck/quiz) awaiting review.
  // Unlike prose drafts this is session-ephemeral: after a reload the block
  // is ordinary content (implicitly kept), so no restore runs for it.
  const [pendingBlock, setPendingBlock] = useState<{ artifactId: string; top: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inlineOpenRef = useRef(false);

  // Legacy attributionLine blocks (retired provenance UI) are stripped on
  // load so an unknown node type can never break the editor; pending prose
  // becomes ordinary text. State initializer runs once per mount (the parent
  // remounts per notebook), keeping it out of effects and recomputation.
  const [sanitizedContent] = useState(() => stripLegacyAttributionNodes(notebook.contentJson));

  const saveDocument = useCallback(async (
    document: NotebookDocument,
    expectedVersion = versionRef.current,
  ): Promise<"saved" | "conflict" | "failed"> => {
    setSaveStatus("saving");
    setSaveError(null);

    try {
      const response = await fetch(`/api/notebooks/${notebook.id}/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contentJson: document, expectedVersion }),
      });
      const payload = (await response.json()) as
        | { status: "saved"; notebook: Notebook }
        | { status: "conflict"; notebook: Notebook }
        | { error: string };

      if (response.status === 409 && "notebook" in payload) {
        setConflict({ notebook: payload.notebook, localVersion: expectedVersion });
        setSaveStatus("conflict");
        return "conflict";
      }

      if (!response.ok || !("notebook" in payload)) {
        throw new Error("error" in payload ? payload.error : "The notebook could not be saved.");
      }

      versionRef.current = payload.notebook.version;
      setSaveStatus("saved");
      setConflict(null);
      onSaved(payload.notebook);
      return "saved";
    } catch (error) {
      setSaveStatus("failed");
      setSaveError(error instanceof Error ? error.message : "The notebook could not be saved.");
      return "failed";
    }
  }, [notebook.id, onSaved]);

  const scheduleSave = useCallback((document: NotebookDocument) => {
    latestDocumentRef.current = document;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      void saveDocument(document);
    }, 700);
  }, [saveDocument]);

  const reportSelection = useCallback(() => {
    const editor = editorHolderRef.current;
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const text = from === to ? "" : editor.state.doc.textBetween(from, to, " ").slice(0, 2000);
    let anchorNodeId: string | undefined;
    if (from !== to) {
      const $from = editor.state.selection.$from;
      for (let depth = $from.depth; depth >= 0; depth -= 1) {
        const id = ($from.node(depth).attrs as Record<string, unknown> | undefined)?.id;
        if (typeof id === "string" && id) {
          anchorNodeId = id;
          break;
        }
      }
    }
    selectionCallbackRef.current?.({ text, from, to, anchorNodeId });
  }, []);

  const scheduleSelectionReport = useCallback(() => {
    if (selectionTimerRef.current) {
      clearTimeout(selectionTimerRef.current);
    }
    selectionTimerRef.current = setTimeout(reportSelection, 150);
  }, [reportSelection]);

  const getVersion = useCallback(() => versionRef.current, []);

  /**
   * Shared insert path for the editor API and the inline Ask-AI box.
   * The document is only touched after the caller validated the artifact,
   * so a failed generation never removes the original selection.
   */
  const applyAndSave = useCallback(async (
    kind: "explanation" | "visual" | "study",
    operation: EditorOperationInput,
    artifact: ArtifactEnvelope,
  ): Promise<ApplyExplanationOutcome> => {
    const current = editorHolderRef.current;
    if (!current) {
      return { ok: false, error: "The editor is not ready yet." };
    }
    const applied =
      kind === "explanation"
        ? applyExplanationOperation(current, operation, artifact)
        : kind === "visual"
          ? applyVisualOperation(current, operation, artifact)
          : applyStudyOperation(current, operation, artifact);
    if (!applied.ok) {
      return applied;
    }
    setArtifacts((previous) => new Map(previous).set(artifact.id, artifact));
    const status = await saveDocument(current.getJSON() as NotebookDocument);
    const label =
      kind === "explanation"
        ? "Explanation"
        : kind === "visual"
          ? artifact.kind === "mermaid" ? "Diagram" : "Image"
          : artifact.kind === "assessment" ? "Assessment" : "Deck";
    if (status === "saved") {
      return {
        ...applied,
        saved: true,
        message: applied.usedFallback
          ? `The anchor moved, so the ${label.toLowerCase()} was appended at the end.`
          : `${label} inserted.`,
      };
    }
    if (status === "conflict") {
      return {
        ...applied,
        saved: false,
        message: "The notebook changed while inserting. Review the conflict above, then generate again.",
      };
    }
    return { ...applied, saved: false, message: "The insert is in the editor but the save failed. Retry the save." };
  }, [saveDocument]);

  // Stable per-mount draft id for fresh pending inserts. Reloaded drafts are
  // located by the pid stored in the document, so this never needs syncing.
  const pendingPid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [pendingUi, setPendingUi] = useState<{ pid: string; top: number } | null>(null);

  /**
   * Locates the pending draft (if any) and its container-relative position
   * for the floating review bar. Pure w.r.t. React state — callers setState.
   */
  const locatePendingUi = useCallback((): { pid: string; top: number } | null => {
    const current = editorHolderRef.current;
    const container = containerRef.current;
    if (!current || !container) return null;
    const found = findPendingDraft(current);
    if (!found) return null;
    try {
      const rect = container.getBoundingClientRect();
      const coords = current.view.coordsAtPos(found.pos);
      return { pid: found.pid, top: coords.bottom - rect.top + 6 };
    } catch {
      return null;
    }
  }, []);

  /**
   * Locates a generated block under review by its artifact id, for the
   * floating review bar. Returns null when the block is gone (e.g. deleted
   * by hand mid-review), which clears the review state.
   */
  const locatePendingBlockTop = useCallback((artifactId: string): { artifactId: string; top: number } | null => {
    const current = editorHolderRef.current;
    const container = containerRef.current;
    if (!current || !container) return null;
    const found = findBlockPosByArtifactId(current, artifactId);
    if (!found) return null;
    try {
      const rect = container.getBoundingClientRect();
      const coords = current.view.coordsAtPos(found.pos);
      return { artifactId, top: coords.bottom - rect.top + 6 };
    } catch {
      return null;
    }
  }, []);

  /**
   * Cursor-driven affordance state. Runs only from editor selection/update
   * handlers (never inside an effect body): a collapsed caret on an empty
   * textblock offers insert-after, a non-empty selection offers replace.
   * Coordinates are container-relative so the affordance and inline box sit
   * at the caret/selection position.
   */
  const refreshInlineAffordance = useCallback(() => {
    const current = editorHolderRef.current;
    const container = containerRef.current;
    // The review bar tracks the pending draft independently of the Ask-AI
    // affordance, so it survives reloads and stays positioned on edits.
    setPendingUi(locatePendingUi());
    // Same tracking for a block under review; clears itself when the block
    // is deleted by hand.
    setPendingBlock((currentBlock) => (currentBlock ? locatePendingBlockTop(currentBlock.artifactId) : null));
    if (!current || !container || inlineOpenRef.current) {
      if (!current || !container) return;
      setAffordance(null);
      return;
    }
    const { from, to } = current.state.selection;
    let containerRect: DOMRect;
    try {
      containerRect = container.getBoundingClientRect();
    } catch {
      return;
    }

    if (from !== to) {
      const text = current.state.doc.textBetween(from, to, " ").slice(0, 2000);
      if (!text.trim()) {
        setAffordance(null);
        return;
      }
      let coords: { top: number; bottom: number; left: number };
      try {
        coords = current.view.coordsAtPos(to);
      } catch {
        return;
      }
      const width = containerRect.width || 1;
      const left = Math.min(Math.max(coords.left - containerRect.left, 8), Math.max(width - 140, 8));
      setAffordance({
        kind: "selection",
        top: coords.bottom - containerRect.top + 6,
        left,
        context: {
          mode: "replace_selection",
          replacementRange: { from, to },
          selectedText: text.trim().slice(0, 2000),
        },
      });
      return;
    }

    const $from = current.state.selection.$from;
    const parent = $from.parent;
    const isEmptyLine = parent.isTextblock && parent.content.size === 0;
    if (!isEmptyLine) {
      setAffordance(null);
      return;
    }
    let anchorNodeId: string | undefined;
    for (let depth = $from.depth; depth >= 0; depth -= 1) {
      const id = ($from.node(depth).attrs as Record<string, unknown> | undefined)?.id;
      if (typeof id === "string" && id) {
        anchorNodeId = id;
        break;
      }
    }
    let coords: { top: number; bottom: number; left: number };
    try {
      coords = current.view.coordsAtPos(from);
    } catch {
      return;
    }
    setAffordance({
      kind: "empty-line",
      top: coords.bottom - containerRect.top + 6,
      left: Math.max(coords.left - containerRect.left, 8),
      context: {
        mode: "insert_after",
        ...(anchorNodeId ? { anchorNodeId } : {}),
        selectedText: "",
      },
    });
  }, [locatePendingUi, locatePendingBlockTop]);

  const notify = useCallback((message: string) => {
    setInlineNotice(message);
    setNoticeSeq((seq) => seq + 1);
  }, []);

  const openInlineBox = useCallback((next: InlineAffordance) => {
    const container = containerRef.current;
    const width = container?.getBoundingClientRect().width ?? 0;
    setInlineContext(next.context);
    // Anchor the box at the selection's left, clamped so a 440px box never
    // overflows the container's right edge.
    setInlinePos({ top: next.top, left: Math.min(next.left, Math.max(width - 448, 8)) });
    setInlineNotice(null);
    inlineOpenRef.current = true;
    setAffordance(null);
  }, []);

  const closeInlineBox = useCallback(() => {
    inlineOpenRef.current = false;
    setInlineContext(null);
    setInlinePos(null);
    editorHolderRef.current?.commands.focus();
  }, []);

  const handleInlineInserted = useCallback((message: string) => {
    notify(message);
    editorHolderRef.current?.commands.focus();
  }, [notify]);

  const dismissInlineNotice = useCallback(() => {
    setInlineNotice(null);
  }, []);

  // Transient notices dismiss themselves after ~3s; the loading bar in the
  // banner visualizes the countdown. Manual Dismiss is instant. Each new
  // notice bumps the sequence so the timer and bar restart together.
  useEffect(() => {
    if (!inlineNotice) return;
    const timer = window.setTimeout(() => setInlineNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [inlineNotice, noticeSeq]);

  /**
   * Inserts a validated explanation as pending prose (no card, no
   * attribution block — inline [Sn] markers are the citation surface), then
   * the normal version-checked save. One draft at a time — enforced here
   * (not just in the UI) so a second draft can never orphan the first.
   */
  const insertPendingAndSave = useCallback(async (
    operation: EditorOperationInput,
    artifact: ArtifactEnvelope,
  ): Promise<ApplyExplanationOutcome> => {
    const current = editorHolderRef.current;
    if (!current) {
      return { ok: false, error: "The editor is not ready yet." };
    }
    if (findPendingDraft(current)) {
      return { ok: false, error: "Accept or discard the pending draft first." };
    }
    const parsed = explanationPayloadSchema.safeParse(artifact.payload);
    if (!parsed.success) {
      return { ok: false, error: "The explanation came back invalid. Nothing was changed — try again." };
    }
    const applied = insertPendingExplanation(
      current,
      operation,
      explanationToTiptapNodes(parsed.data),
      pendingPid,
    );
    if (!applied.ok) {
      return applied;
    }
    const status = await saveDocument(current.getJSON() as NotebookDocument);
    if (status === "saved") {
      return {
        ...applied,
        saved: true,
        message: applied.usedFallback
          ? "The anchor moved, so the draft was appended at the end — accept or discard below."
          : "Draft inserted below — accept or discard.",
      };
    }
    if (status === "conflict") {
      return {
        ...applied,
        saved: false,
        message: "The notebook changed while inserting. Review the conflict above, then generate again.",
      };
    }
    return { ...applied, saved: false, message: "The draft is in the editor but the save failed. Retry the save." };
  }, [pendingPid, saveDocument]);

  const acceptPending = useCallback(async () => {
    const current = editorHolderRef.current;
    if (!current) return;
    const found = findPendingDraft(current);
    if (!found || !acceptPendingExplanation(current, found.pid)) {
      setPendingUi(null);
      notify("The pending draft is already gone.");
      return;
    }
    setPendingUi(null);
    const status = await saveDocument(current.getJSON() as NotebookDocument);
    if (status === "saved") {
      notify("Accepted — the text is now part of the notebook.");
    } else if (status === "conflict") {
      notify("Accepted locally, but the notebook changed — review the conflict above.");
    } else {
      notify("Accepted locally, but the save failed. Retry the save.");
    }
  }, [saveDocument, notify]);

  const discardPending = useCallback(async () => {
    const current = editorHolderRef.current;
    if (!current) return;
    const found = findPendingDraft(current);
    if (!found) {
      setPendingUi(null);
      notify("The pending draft is already gone.");
      return;
    }
    const outcome = discardPendingExplanation(current, found.pid);
    setPendingUi(null);
    if (!outcome.ok) {
      notify("The pending draft is already gone.");
      return;
    }
    const status = await saveDocument(current.getJSON() as NotebookDocument);
    const detail = outcome.restored ? " The original passage was restored." : "";
    if (status === "saved") {
      notify(`Discarded.${detail}`);
    } else if (status === "conflict") {
      notify(`Discarded locally, but the notebook changed — review the conflict above.${detail}`);
    } else {
      notify(`Discarded locally, but the save failed. Retry the save.${detail}`);
    }
  }, [saveDocument, notify]);

  /**
   * Inserts a validated visual/study block, then pins the accept/discard
   * review bar to it — fresh generations get the same review step that
   * explanation replacements already had. One review at a time: when a
   * prose draft or another block is pending, generation is refused instead
   * of orphaning the earlier draft.
   */
  const applyBlockWithReview = useCallback(async (
    kind: "visual" | "study",
    operation: EditorOperationInput,
    artifact: ArtifactEnvelope,
  ): Promise<ApplyExplanationOutcome> => {
    const current = editorHolderRef.current;
    if (!current) {
      return { ok: false, error: "The editor is not ready yet." };
    }
    if (findPendingDraft(current) || pendingBlock) {
      return { ok: false, error: "Accept or discard the pending draft first." };
    }
    const outcome = await applyAndSave(kind, operation, artifact);
    if (!outcome.ok) {
      return outcome;
    }
    const placed = locatePendingBlockTop(artifact.id);
    if (placed) {
      setPendingBlock(placed);
    }
    const label =
      kind === "visual"
        ? artifact.kind === "mermaid" ? "Diagram" : "Image"
        : artifact.kind === "assessment" ? "Assessment" : "Deck";
    const where = outcome.usedFallback ? "at the end" : "below";
    return {
      ...outcome,
      message: outcome.saved
        ? `${label} inserted ${where} — accept or discard.`
        : `${label} is in the editor but the save failed — accept to keep it or discard to remove it.`,
    };
  }, [applyAndSave, locatePendingBlockTop, pendingBlock]);

  /** Accepts the block under review: it is already saved, so this only clears the bar. */
  const acceptPendingBlock = useCallback(() => {
    const current = editorHolderRef.current;
    const artifactId = pendingBlock?.artifactId;
    setPendingBlock(null);
    if (!current || !artifactId || !findBlockPosByArtifactId(current, artifactId)) {
      notify("The block is already gone.");
      return;
    }
    notify("Kept — the block stays in the notebook.");
  }, [pendingBlock, notify]);

  /** Discards the block under review: removes the node, drops its cached artifact, and saves. */
  const discardPendingBlock = useCallback(async () => {
    const current = editorHolderRef.current;
    const artifactId = pendingBlock?.artifactId;
    setPendingBlock(null);
    if (!current || !artifactId || !deleteBlockByArtifactId(current, artifactId)) {
      notify("The block is already gone.");
      return;
    }
    setArtifacts((previous) => {
      if (!previous.has(artifactId)) return previous;
      const next = new Map(previous);
      next.delete(artifactId);
      return next;
    });
    const status = await saveDocument(current.getJSON() as NotebookDocument);
    if (status === "saved") {
      notify("Discarded — the block was removed.");
    } else if (status === "conflict") {
      notify("Discarded locally, but the notebook changed — review the conflict above.");
    } else {
      notify("Discarded locally, but the save failed. Retry the save.");
    }
  }, [pendingBlock, saveDocument, notify]);

  const handleInlineApply = useCallback(async (
    kind: "explanation" | "visual" | "study",
    operation: EditorOperationInput,
    artifact: ArtifactEnvelope,
  ) => {
    // Explanations flow into pending prose (accept/discard); freshly
    // generated blocks pin the same review bar to the inserted node.
    if (kind === "explanation") {
      return insertPendingAndSave(operation, artifact);
    }
    return applyBlockWithReview(kind, operation, artifact);
  }, [applyBlockWithReview, insertPendingAndSave]);

  const editor = useEditor(
    {
      immediatelyRender: false,
      extensions: editorExtensions,
      content: sanitizedContent as JSONContent,
      editorProps: {
        attributes: {
          class: "min-h-[460px] px-1 py-2 focus:outline-none",
        },
      },
      onUpdate: ({ editor: updatedEditor }) => {
        scheduleSave(updatedEditor.getJSON() as NotebookDocument);
        scheduleSelectionReport();
        refreshInlineAffordance();
      },
      onSelectionUpdate: () => {
        scheduleSelectionReport();
        refreshInlineAffordance();
      },
    },
    [notebook.id],
  );

  useEffect(() => {
    editorHolderRef.current = editor;
    // Pick up a pending draft restored from the saved document (e.g. after
    // a reload) so its review bar appears without waiting for interaction.
    const timer = window.setTimeout(() => {
      setPendingUi(locatePendingUi());
    }, 0);
    return () => {
      editorHolderRef.current = null;
      window.clearTimeout(timer);
    };
  }, [editor, locatePendingUi]);

  useEffect(() => {
    versionRef.current = notebook.version;
    latestDocumentRef.current = stripLegacyAttributionNodes(notebook.contentJson);
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [notebook.id, notebook.version, notebook.contentJson]);

  // Hydrate generated blocks so AI-inserted content renders after reload.
  // The editor remounts per notebook, so the initial map is always fresh.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const load = async () => {
        try {
          const response = await fetch(`/api/artifacts?notebookId=${notebook.id}`, { cache: "no-store" });
          if (!response.ok) return;
          const payload = (await response.json()) as { artifacts?: unknown[] };
          if (cancelled || !Array.isArray(payload.artifacts)) return;
          const next = new Map<string, ArtifactEnvelope>();
          for (const entry of payload.artifacts) {
            const parsed = artifactEnvelopeSchema.safeParse(entry);
            if (parsed.success) {
              // Keep lifecycle fields for visual blocks (status/error) without
              // changing the shared envelope type used by older views.
              const raw = entry as { status?: unknown; error?: unknown };
              next.set(parsed.data.id, {
                ...parsed.data,
                ...(typeof raw.status === "string" ? { status: raw.status } : {}),
                ...(raw.error === null || typeof raw.error === "string" ? { error: raw.error } : {}),
              } as ArtifactEnvelope);
            }
          }
          if (!cancelled) setArtifacts(next);
        } catch {
          // Generated blocks fall back to their cached title/summary.
        }
      };
      void load();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [notebook.id]);

  useEffect(() => {
    if (!editorApiRef) return;
    editorApiRef.current = {
      getSelection: () => {
        const current = editorHolderRef.current;
        if (!current) return { text: "", from: 0, to: 0 };
        const { from, to } = current.state.selection;
        const text = from === to ? "" : current.state.doc.textBetween(from, to, " ").slice(0, 2000);
        return { text, from, to };
      },
      getVersion,
      applyExplanation: async (operation, artifact) => applyAndSave("explanation", operation, artifact),
      applyVisual: async (operation, artifact) => {
        if (artifact.kind !== "mermaid" && artifact.kind !== "image") {
          return { ok: false as const, error: "This block type is not supported here." };
        }
        return applyAndSave("visual", operation, artifact);
      },
      applyStudy: async (operation, artifact) => {
        if (artifact.kind !== "flashcards" && artifact.kind !== "assessment") {
          return { ok: false as const, error: "This block type is not supported here." };
        }
        return applyAndSave("study", operation, artifact);
      },
    };
    return () => {
      editorApiRef.current = null;
    };
  }, [editorApiRef, applyAndSave, getVersion]);

  const retrySave = () => {
    void saveDocument(latestDocumentRef.current, conflict?.notebook.version ?? versionRef.current);
  };

  const upsertArtifact = useCallback((artifact: ArtifactWithStatus) => {
    setArtifacts((previous) => new Map(previous).set(artifact.id, artifact as ArtifactEnvelope));
  }, []);

  const reloadServerCopy = () => {
    if (!editor || !conflict) return;
    versionRef.current = conflict.notebook.version;
    editor.commands.setContent(stripLegacyAttributionNodes(conflict.notebook.contentJson) as JSONContent, { emitUpdate: false });
    setConflict(null);
    setSaveError(null);
    setSaveStatus("saved");
  };

  if (!editor) {
    return <Card className="min-h-[620px]" />;
  }

  return (
    <ExplanationArtifactsContext.Provider value={artifacts}>
      <ArtifactUpsertContext.Provider value={upsertArtifact}>
      {/* Flat sheet: no outer box (the sidebar edge is the only vertical line),
          header + toolbar stick together while content scrolls. */}
      <Card className="overflow-visible border-0">
      <div className="sticky top-0 z-20 bg-white">
        <CardHeader className="border-b border-border px-5 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 font-body text-xs text-text-dim">
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              <NextLink href="/" className="pressable shrink-0 hover:text-text hover:underline">
                Workspace
              </NextLink>
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              <NextLink href={`/courses/${courseId}`} className="pressable shrink-0 hover:text-text hover:underline">
                {courseTitle ?? "Course"}
              </NextLink>
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate font-heading text-sm font-medium tracking-[-0.01em] text-text">
                {notebook.title}
              </span>
            </nav>
            <SaveIndicator status={saveStatus} />
            <ManageItemButton id={notebook.id} courseId={courseId} kind="notebook" title={notebook.title} showLabel />
          </div>
          {saveStatus === "conflict" && conflict ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 border border-border-strong bg-paper p-3 font-body text-xs text-text">
              <AlertCircle className="h-4 w-4 shrink-0 text-blue" />
              <span className="flex-1">This copy started at version {conflict.localVersion}, but the server is now at version {conflict.notebook.version}. Choose which copy to keep.</span>
              <Button size="sm" variant="outline" onClick={reloadServerCopy}>Reload server copy</Button>
              <Button size="sm" variant="secondary" onClick={retrySave}>Keep my edits</Button>
            </div>
          ) : null}
          {saveStatus === "failed" ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 border border-[#f2d1cf] bg-[#fff4f3] p-3 font-body text-xs text-[#93443d]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span className="flex-1">{saveError ?? "The save failed."}</span>
              <Button size="sm" variant="danger" onClick={retrySave}><RefreshCw className="h-3.5 w-3.5" /> Retry</Button>
            </div>
          ) : null}
        </CardHeader>
          <div className="flex flex-wrap items-center gap-1 border-b border-border bg-white px-5 py-2">
            <button type="button" className={toolbarButtonClass(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Bold"><Bold className="h-3.5 w-3.5" /></button>
            <button type="button" className={toolbarButtonClass(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Italic"><Italic className="h-3.5 w-3.5" /></button>
            <button type="button" className={toolbarButtonClass(editor.isActive("heading", { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} aria-label="Heading"><Heading2 className="h-3.5 w-3.5" /></button>
            <button type="button" className={toolbarButtonClass(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()} aria-label="Bullet list"><List className="h-3.5 w-3.5" /></button>
            <button type="button" className={toolbarButtonClass(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()} aria-label="Numbered list"><ListOrdered className="h-3.5 w-3.5" /></button>
            <button type="button" className={toolbarButtonClass(editor.isActive("codeBlock"))} onClick={() => editor.chain().focus().toggleCodeBlock().run()} aria-label="Code block"><Code2 className="h-3.5 w-3.5" /></button>
            <button type="button" className={toolbarButtonClass(editor.isActive("link"))} onClick={() => {
              const href = window.prompt("Paste a URL");
              if (href) editor.chain().focus().setLink({ href }).run();
            }} aria-label="Add link"><Link2 className="h-3.5 w-3.5" /></button>
          </div>
          </div>
        <CardContent className="p-0">
          <div className="px-6 py-6">
            {inlineNotice ? (
              <div className="relative mb-3 flex flex-wrap items-center gap-3 overflow-hidden border border-blue/25 bg-blue-tint px-3 py-2 font-body text-xs leading-5 text-blue">
                <span className="flex-1">{inlineNotice}</span>
                <button
                  type="button"
                  onClick={dismissInlineNotice}
                  className="pressable font-medium hover:underline"
                  aria-label="Dismiss notice"
                >
                  Dismiss
                </button>
                <span key={noticeSeq} aria-hidden="true" className="notice-countdown absolute bottom-0 left-0 h-0.5 w-full bg-blue/60" />
              </div>
            ) : null}
            <div ref={containerRef} className="relative">
              <EditorContent editor={editor} />
              {affordance && !inlineContext ? (
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => openInlineBox(affordance)}
                  style={{ top: affordance.top, left: affordance.left }}
                  className="pressable absolute z-10 inline-flex items-center gap-1 border border-blue bg-blue px-2 py-1 font-body text-[11px] font-medium text-white shadow-md transition-colors hover:bg-blue-hover"
                  aria-label={affordance.kind === "selection" ? "Ask AI about selection" : "Ask AI at this line"}
                >
                  <Sparkles className="h-3 w-3" /> Ask AI
                </button>
              ) : null}
              {inlineContext && inlinePos ? (
                <div
                  style={{ top: inlinePos.top, left: inlinePos.left }}
                  className="absolute z-20 w-[calc(100%-16px)] max-w-[440px]"
                >
                  <InlineAskBox
                    context={inlineContext}
                    courseId={notebook.courseId}
                    notebookId={notebook.id}
                    getVersion={getVersion}
                    onApply={handleInlineApply}
                    onClose={closeInlineBox}
                    onInserted={handleInlineInserted}
                    explanationLocked={pendingUi !== null || pendingBlock !== null}
                  />
                </div>
              ) : null}
              {pendingUi && !inlineContext ? (
                <div
                  style={{ top: pendingUi.top }}
                  className="absolute z-20 left-0 right-0 mx-auto w-fit max-w-full"
                >
                  <PendingBar onAccept={() => void acceptPending()} onDiscard={() => void discardPending()} />
                </div>
              ) : null}
              {pendingBlock && !pendingUi && !inlineContext ? (
                <div
                  style={{ top: pendingBlock.top }}
                  className="absolute z-20 left-0 right-0 mx-auto w-fit max-w-full"
                >
                  <PendingBar
                    label="Review block"
                    onAccept={() => acceptPendingBlock()}
                    onDiscard={() => void discardPendingBlock()}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>
      </ArtifactUpsertContext.Provider>
    </ExplanationArtifactsContext.Provider>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "saving") {
    return <Badge className="border-border bg-bg-alt text-text-muted"><LoaderCircle className="h-3 w-3 animate-spin" /> Saving</Badge>;
  }
  if (status === "conflict") {
    return <Badge className="border-border-strong bg-paper text-text">Conflict</Badge>;
  }
  if (status === "failed") {
    return <Badge className="border-[#f2d1cf] bg-[#fff4f3] text-[#a53f34]">Save failed</Badge>;
  }
  return <Badge className="border-blue/25 bg-blue-tint text-blue"><Save className="h-3 w-3" /> Saved</Badge>;
}
