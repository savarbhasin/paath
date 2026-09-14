"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ManageItemButton({ id, courseId, kind, title, restore = false, onDone, showLabel = false }: {
  id: string; courseId: string; kind: "course" | "notebook" | "artifact"; title: string; restore?: boolean; onDone?: () => void; showLabel?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const descriptionId = useId();
  function close() {
    if (busy) return;
    dialog.current?.close();
    setError(null);
  }
  const router = useRouter();
  const label = kind === "course" ? restore ? "Restore" : "Archive" : "Delete";
  async function act() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/manage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, courseId, kind, restore }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update item.");
      dialog.current?.close();
      window.dispatchEvent(new Event("workspace-updated"));
      onDone?.();
      if (kind === "course" && !restore && window.location.pathname.includes(courseId)) router.push("/");
      else if (kind !== "course" && window.location.pathname.includes(id)) router.push(`/courses/${courseId}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not update item.");
      if (!dialog.current?.open) dialog.current?.showModal();
    } finally { setBusy(false); }
  }
  const Icon = kind === "course" ? restore ? RotateCcw : Archive : Trash2;
  return <>
    <button type="button" disabled={busy} onClick={() => { setError(null); if (kind === "course") void act(); else dialog.current?.showModal(); }} title={`${label} ${title}`} aria-label={`${label} ${title}`} className={showLabel ? "pressable inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap border border-border px-2 text-xs! leading-none! text-text-muted hover:bg-bg-alt hover:text-text disabled:opacity-50" : "shrink-0 p-1 text-text-dim hover:text-text disabled:opacity-50"}><Icon className="h-3.5 w-3.5" />{showLabel ? kind === "course" ? `${label} course` : kind === "notebook" ? "Delete notebook" : "Delete" : null}</button>
    <dialog ref={dialog} aria-labelledby={headingId} aria-describedby={descriptionId} onCancel={event => { event.preventDefault(); close(); }} className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm border border-border bg-white p-5 text-left text-text shadow-xl backdrop:bg-black/30">
      <h2 id={headingId} className="break-words font-heading text-lg font-medium">{label} “{title}”{kind === "course" ? "" : "?"}</h2>
      <p id={descriptionId} className="mt-3 text-sm leading-6 text-text-muted">{kind === "course" ? "The course could not be updated. You can try again." : kind === "notebook" ? "This permanently deletes the notebook, its generated content, and its review records. This cannot be undone." : "This permanently deletes this item and its reviews and attempts. This cannot be undone."}</p>
      {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" autoFocus disabled={busy} onClick={close}>Cancel</Button>
        <Button type="button" variant={kind === "course" ? "outline" : "danger"} size="sm" disabled={busy} onClick={() => void act()}>{busy ? "Saving…" : kind === "course" ? "Retry" : "Delete"}</Button>
      </div>
    </dialog>
  </>;
}
