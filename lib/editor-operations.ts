import { z } from "zod";

import type { Editor, JSONContent } from "@tiptap/core";
import { Fragment, type Mark, type MarkType, type Node as PMNode } from "@tiptap/pm/model";

import type { ArtifactEnvelope } from "@/lib/contracts";
import type { EditorOperationInput } from "@/lib/tutor";

export type ApplyOperationResult =
  | { ok: true; usedFallback: boolean }
  | { ok: false; error: string };

export function findNodePosById(editor: Editor, nodeId: string): { pos: number; size: number } | null {
  let found: { pos: number; size: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    const id = (node.attrs as Record<string, unknown> | undefined)?.id;
    if (typeof id === "string" && id === nodeId) {
      found = { pos, size: node.nodeSize };
      return false;
    }
    return true;
  });
  return found;
}

/**
 * Applies a typed AI editor operation. Returns a failure without touching
 * the document when the anchor or range is invalid, so the caller can show
 * a recovery action instead of corrupting the notebook.
 */
export function applyExplanationOperation(
  editor: Editor,
  operation: EditorOperationInput,
  artifact: ArtifactEnvelope,
): ApplyOperationResult {
  const node = {
    type: "explanationBlock",
    attrs: {
      artifactId: artifact.id,
      title: artifact.title,
      summary: typeof (artifact.payload as Record<string, unknown> | null)?.summary === "string"
        ? ((artifact.payload as Record<string, unknown>).summary as string).slice(0, 500)
        : "",
    },
  };

  if (operation.operation === "append") {
    editor.chain().focus().insertContentAt(editor.state.doc.content.size, node).run();
    return { ok: true, usedFallback: false };
  }

  if (operation.operation === "insert_after") {
    if (operation.anchorNodeId) {
      const anchor = findNodePosById(editor, operation.anchorNodeId);
      if (anchor) {
        editor.chain().focus().insertContentAt(anchor.pos + anchor.size, node).run();
        return { ok: true, usedFallback: false };
      }
    }
    // The anchor is gone (edits since generation) — append instead of dropping
    // the validated artifact, and tell the caller so it can say so.
    editor.chain().focus().insertContentAt(editor.state.doc.content.size, node).run();
    return { ok: true, usedFallback: true };
  }

  // replace_selection
  const range = operation.replacementRange;
  if (range) {
    const docSize = editor.state.doc.content.size;
    if (range.from < 0 || range.to < range.from || range.to > docSize) {
      return { ok: false, error: "The selected passage moved. Regenerate against the current selection." };
    }
    editor.chain().focus().deleteRange(range).insertContentAt(range.from, node).run();
    return { ok: true, usedFallback: false };
  }

  const { from, to } = editor.state.selection;
  if (from === to) {
    return { ok: false, error: "Select the passage to replace first, then generate again." };
  }
  editor.chain().focus().insertContent(node).run();
  return { ok: true, usedFallback: false };
}

const VISUAL_NODE_TYPE = {
  mermaid: "mermaidBlock",
  image: "generatedImageBlock",
} as const;

/**
 * Applies a mermaid/image editor operation. Works for ready and failed
 * payloads alike: a failed insert stores only the artifact id plus cached
 * title/caption, so the failed block is isolated and the rest of the
 * notebook stays editable.
 */
export function applyVisualOperation(
  editor: Editor,
  operation: EditorOperationInput,
  artifact: ArtifactEnvelope,
): ApplyOperationResult {
  const nodeType = artifact.kind === "mermaid" ? VISUAL_NODE_TYPE.mermaid : VISUAL_NODE_TYPE.image;
  const record = (artifact.payload ?? {}) as Record<string, unknown>;
  const caption =
    typeof record.caption === "string"
      ? (record.caption as string).slice(0, 500)
      : typeof record.alt === "string"
        ? (record.alt as string).slice(0, 500)
        : "";
  const node = {
    type: nodeType,
    attrs: {
      artifactId: artifact.id,
      title: artifact.title,
      caption,
    },
  };

  if (operation.operation === "append") {
    editor.chain().focus().insertContentAt(editor.state.doc.content.size, node).run();
    return { ok: true, usedFallback: false };
  }

  if (operation.operation === "insert_after") {
    if (operation.anchorNodeId) {
      const anchor = findNodePosById(editor, operation.anchorNodeId);
      if (anchor) {
        editor.chain().focus().insertContentAt(anchor.pos + anchor.size, node).run();
        return { ok: true, usedFallback: false };
      }
    }
    editor.chain().focus().insertContentAt(editor.state.doc.content.size, node).run();
    return { ok: true, usedFallback: true };
  }

  // replace_selection
  const range = operation.replacementRange;
  if (range) {
    const docSize = editor.state.doc.content.size;
    if (range.from < 0 || range.to < range.from || range.to > docSize) {
      return { ok: false, error: "The selected passage moved. Regenerate against the current selection." };
    }
    editor.chain().focus().deleteRange(range).insertContentAt(range.from, node).run();
    return { ok: true, usedFallback: false };
  }

  const { from, to } = editor.state.selection;
  if (from === to) {
    return { ok: false, error: "Select the passage to replace first, then generate again." };
  }
  editor.chain().focus().insertContent(node).run();
  return { ok: true, usedFallback: false };
}

const STUDY_NODE_TYPE = {
  flashcards: "flashcardDeckBlock",
  assessment: "assessmentBlock",
} as const;

/**
 * Applies a flashcards/assessment editor operation. The document stores only
 * the artifact id plus cached title/subtitle; cards, questions, reviews, and
 * attempts live in `learning_artifacts` and hydrate through context.
 */
export function applyStudyOperation(
  editor: Editor,
  operation: EditorOperationInput,
  artifact: ArtifactEnvelope,
): ApplyOperationResult {
  const nodeType = artifact.kind === "assessment" ? STUDY_NODE_TYPE.assessment : STUDY_NODE_TYPE.flashcards;
  const record = (artifact.payload ?? {}) as Record<string, unknown>;
  const subtitle = (
    artifact.kind === "assessment"
      ? `${record.mode === "quiz" ? "Quiz" : "Practice"} · ${Array.isArray(record.questions) ? record.questions.length : 0} questions`
      : `${Array.isArray(record.cards) ? record.cards.length : 0} cards`
  ).slice(0, 120);
  const node = {
    type: nodeType,
    attrs: {
      artifactId: artifact.id,
      title: artifact.title,
      subtitle,
    },
  };

  if (operation.operation === "append") {
    editor.chain().focus().insertContentAt(editor.state.doc.content.size, node).run();
    return { ok: true, usedFallback: false };
  }

  if (operation.operation === "insert_after") {
    if (operation.anchorNodeId) {
      const anchor = findNodePosById(editor, operation.anchorNodeId);
      if (anchor) {
        editor.chain().focus().insertContentAt(anchor.pos + anchor.size, node).run();
        return { ok: true, usedFallback: false };
      }
    }
    editor.chain().focus().insertContentAt(editor.state.doc.content.size, node).run();
    return { ok: true, usedFallback: true };
  }

  // replace_selection
  const range = operation.replacementRange;
  if (range) {
    const docSize = editor.state.doc.content.size;
    if (range.from < 0 || range.to < range.from || range.to > docSize) {
      return { ok: false, error: "The selected passage moved. Regenerate against the current selection." };
    }
    editor.chain().focus().deleteRange(range).insertContentAt(range.from, node).run();
    return { ok: true, usedFallback: false };
  }

  const { from, to } = editor.state.selection;
  if (from === to) {
    return { ok: false, error: "Select the passage to replace first, then generate again." };
  }
  editor.chain().focus().insertContent(node).run();
  return { ok: true, usedFallback: false };
}

/**
 * Inserts validated explanation prose as ordinary Tiptap nodes marked pending
 * in a single transaction. No card and no attribution block — inline `[Sn]`
 * markers in the text are the only citation surface. Nothing is deleted for
 * replace flows until this runs, so the caller must only invoke it after the
 * payload validates. The original passage is stashed on the first marked
 * span (mark attrs round-trip through the saved JSON) for discard-restore.
 * The anchor/range rules mirror the card operations.
 */
export function insertPendingExplanation(
  editor: Editor,
  operation: EditorOperationInput,
  nodes: JSONContent[],
  pid: string,
): ApplyOperationResult {
  if (nodes.length === 0) {
    return { ok: false, error: "The explanation came back empty. Nothing was changed — try again." };
  }
  const markType = editor.schema.marks.pendingInsert;
  if (!markType) {
    return { ok: false, error: "The editor is not ready for review inserts yet." };
  }
  let fragment: ReturnType<typeof Fragment.fromJSON>;
  try {
    fragment = Fragment.fromJSON(editor.schema, nodes);
  } catch {
    return { ok: false, error: "The explanation could not be shaped into text. Nothing was changed — try again." };
  }
  if (fragment.size === 0) {
    return { ok: false, error: "The explanation came back empty. Nothing was changed — try again." };
  }

  // Replace flow: bounds-check first, then delete + insert atomically.
  if (operation.operation === "replace_selection" && operation.replacementRange) {
    const { from, to } = operation.replacementRange;
    const docSize = editor.state.doc.content.size;
    if (from < 0 || to < from || to > docSize) {
      return { ok: false, error: "The selected passage moved. Regenerate against the current selection." };
    }
    const originalText = editor.state.doc.textBetween(from, to, " ").slice(0, 2000);
    const tr = editor.state.tr;
    tr.delete(from, to);
    tr.insert(from, fragment);
    tr.addMark(from, from + fragment.size, markType.create({ pid }));
    stampOrigin(tr.doc, tr.addMark.bind(tr), markType, pid, originalText);
    editor.view.dispatch(tr);
    return { ok: true, usedFallback: false };
  }

  // Insert-after flow (append when no usable anchor, like the card path).
  let usedFallback = false;
  let pos = editor.state.doc.content.size;
  if (operation.anchorNodeId) {
    const anchor = findNodePosById(editor, operation.anchorNodeId);
    if (anchor) {
      pos = anchor.pos + anchor.size;
    } else {
      usedFallback = true;
    }
  }
  const tr = editor.state.tr;
  tr.insert(pos, fragment);
  tr.addMark(pos, pos + fragment.size, markType.create({ pid }));
  editor.view.dispatch(tr);
  return { ok: true, usedFallback };
}

/**
 * Stamps the restore data onto the first marked span so discard can bring
 * back a replaced passage. Other spans carry the pid alone, keeping the
 * saved document lean. Skipped when there is nothing to restore.
 */
function stampOrigin(
  doc: PMNode,
  addMark: (from: number, to: number, mark: Mark) => void,
  markType: MarkType,
  pid: string,
  originalText: string,
): void {
  if (!originalText.trim()) return;
  const origin = originalText.slice(0, 2000);
  let done = false;
  doc.descendants((node, pos) => {
    if (done || !node.isText) return false;
    const mark = node.marks.find((entry) => entry.type === markType && entry.attrs.pid === pid);
    if (!mark) return true;
    addMark(pos, pos + node.nodeSize, markType.create({ pid, origin, mode: "replace_selection" }));
    done = true;
    return false;
  });
}

export type FoundPending = {
  pid: string;
  /** Position of the first marked span. */
  pos: number;
};

function pendingMarkOf(node: PMNode, markType: MarkType, pid?: string): Mark | null {
  const mark = node.marks.find(
    (entry) =>
      entry.type === markType &&
      typeof entry.attrs.pid === "string" &&
      entry.attrs.pid &&
      (pid === undefined || entry.attrs.pid === pid),
  );
  return mark ?? null;
}

/**
 * Locates the pending draft by its review mark alone. Survives reloads
 * because the mark (and its pid) lives in the saved document.
 */
export function findPendingDraft(editor: Editor): FoundPending | null {
  const markType = editor.schema.marks.pendingInsert;
  if (!markType) return null;
  let found: FoundPending | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isText) return false;
    const mark = pendingMarkOf(node, markType);
    if (mark) {
      found = { pid: mark.attrs.pid as string, pos };
      return false;
    }
    return true;
  });
  return found;
}

/**
 * Accepts the pending draft: the tint marks come off so the prose becomes
 * ordinary document text. Marks don't shift positions, so one transaction
 * is safe.
 */
export function acceptPendingExplanation(editor: Editor, pid: string): boolean {
  const markType = editor.schema.marks.pendingInsert;
  if (!markType) return false;
  const ranges: { from: number; to: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    if (!pendingMarkOf(node, markType, pid)) return true;
    const from = pos;
    const to = pos + node.nodeSize;
    const last = ranges[ranges.length - 1];
    if (last && last.to === from) {
      last.to = to;
    } else {
      ranges.push({ from, to });
    }
    return true;
  });
  if (ranges.length === 0) return false;
  const tr = editor.state.tr;
  for (const range of ranges) {
    tr.removeMark(range.from, range.to, markType);
  }
  editor.view.dispatch(tr);
  return true;
}

/**
 * Discards the pending draft: marked prose is removed; for replace flows the
 * original passage stashed on the first marked span is re-inserted as plain
 * paragraphs at the same spot (block structure flattened). Positions are
 * resolved through the transaction mapping so a single dispatch suffices.
 */
export function discardPendingExplanation(editor: Editor, pid: string): { ok: boolean; restored: boolean } {
  const markType = editor.schema.marks.pendingInsert;
  if (!markType) return { ok: false, restored: false };
  const ranges: { from: number; to: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    if (!pendingMarkOf(node, markType, pid)) return true;
    ranges.push({ from: pos, to: pos + node.nodeSize });
    return true;
  });
  if (ranges.length === 0) return { ok: false, restored: false };
  const origin = findOriginMark(editor, markType, pid);

  const tr = editor.state.tr;
  const ordered = [...ranges].sort((a, b) => b.from - a.from);
  for (const range of ordered) {
    tr.delete(range.from, range.to);
  }
  let restored = false;
  if (origin !== null) {
    const mapped = tr.mapping.map(origin.pos);
    const chunks = origin.text
      .split(/\n\s*\n/)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0)
      .slice(0, 50);
    if (chunks.length > 0) {
      const restore = Fragment.fromJSON(
        editor.schema,
        chunks.map((chunk) => ({
          type: "paragraph",
          content: [{ type: "text", text: chunk.slice(0, 2000) }],
        })),
      );
      if (restore.size > 0) {
        tr.insert(mapped, restore);
        restored = true;
      }
    }
  }
  editor.view.dispatch(tr);
  return { ok: true, restored };
}

/**
 * Locates a generated block node by its `artifactId` attr (visual/study
 * blocks carry the artifact id, not a UniqueID `id`). Used to pin the
 * review bar to a freshly inserted block and to remove it on discard.
 */
export function findBlockPosByArtifactId(editor: Editor, artifactId: string): { pos: number; size: number } | null {
  let found: { pos: number; size: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    const id = (node.attrs as Record<string, unknown> | undefined)?.artifactId;
    if (typeof id === "string" && id === artifactId) {
      found = { pos, size: node.nodeSize };
      return false;
    }
    return true;
  });
  return found;
}

/**
 * Removes the generated block node carrying `artifactId`. Returns false
 * when the node is already gone (e.g. deleted by hand mid-review).
 */
export function deleteBlockByArtifactId(editor: Editor, artifactId: string): boolean {
  const found = findBlockPosByArtifactId(editor, artifactId);
  if (!found) return false;
  editor.view.dispatch(editor.state.tr.delete(found.pos, found.pos + found.size));
  return true;
}

/**
 * Finds the restore stamp: the first marked span carrying a replace-mode
 * original passage. Returned (not closed over) so callers can narrow it.
 */
function findOriginMark(
  editor: Editor,
  markType: MarkType,
  pid: string,
): { pos: number; text: string } | null {
  let origin: { pos: number; text: string } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (origin !== null || !node.isText) return false;
    const mark = pendingMarkOf(node, markType, pid);
    if (
      mark &&
      mark.attrs.mode === "replace_selection" &&
      typeof mark.attrs.origin === "string" &&
      mark.attrs.origin.trim().length > 0
    ) {
      origin = { pos, text: mark.attrs.origin };
    }
    return origin !== null ? false : true;
  });
  return origin;
}

export const artifactEnvelopeSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  title: z.string(),
  sourceIds: z.array(z.string()),
  topicKeys: z.array(z.string()),
  citations: z.array(
    z.object({
      sourceId: z.string(),
      title: z.string(),
      excerpt: z.string().optional(),
      marker: z.string().optional(),
      locator: z.object({ kind: z.enum(["page", "timestamp", "section"]), value: z.string() }).optional(),
    }),
  ),
  payload: z.unknown(),
});

export function parseArtifactEnvelope(value: unknown): ArtifactEnvelope {
  return artifactEnvelopeSchema.parse(value) as ArtifactEnvelope;
}
