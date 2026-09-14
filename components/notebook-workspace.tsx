"use client";

import { useCallback, useRef, useState } from "react";

import { NotebookEditor, type NotebookEditorApi, type NotebookSelection } from "@/components/notebook-editor";
import { TutorFloat } from "@/components/tutor-float";
import type { Notebook } from "@/lib/domain";

const EMPTY_SELECTION = { text: "", from: 0, to: 0 };

/**
 * Full-width notebook workspace: the editor owns the page, with a floating
 * tutor behind a bottom-left circle button. Selection reporting stays wired
 * so the tutor keeps its selection context.
 */
export function NotebookWorkspace({
  courseId,
  courseTitle,
  initialNotebook,
}: {
  courseId: string;
  courseTitle: string | null;
  initialNotebook: Notebook;
}) {
  const [notebook, setNotebook] = useState<Notebook>(initialNotebook);
  const editorApiRef = useRef<NotebookEditorApi | null>(null);
  const [selection, setSelection] = useState<NotebookSelection>({ text: "", from: 0, to: 0 });
  const [selectionNotebookId, setSelectionNotebookId] = useState<string | null>(null);

  const handleSelectionChange = useCallback(
    (next: NotebookSelection) => {
      setSelection(next);
      setSelectionNotebookId(notebook.id);
    },
    [notebook.id],
  );

  // A selection belongs to one notebook document; ignore it after a switch.
  const selectionForPanel = selectionNotebookId === notebook.id ? selection : EMPTY_SELECTION;

  return (
    <div>
      <NotebookEditor
        key={notebook.id}
        notebook={notebook}
        courseId={courseId}
        courseTitle={courseTitle}
        onSaved={setNotebook}
        editorApiRef={editorApiRef}
        onSelectionChange={handleSelectionChange}
      />
      <TutorFloat
        key={`tutor-${courseId}-${notebook.id}`}
        courseId={courseId}
        notebook={notebook}
        selection={selectionForPanel}
      />
      {/* Connections (RelatedPanel) parked — backend kept, UI unwired. */}
    </div>
  );
}
