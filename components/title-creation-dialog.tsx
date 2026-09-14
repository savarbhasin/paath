"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TitleCreationDialog({ open, kind, onClose, onCreate }: {
  open: boolean;
  kind: "course" | "notebook";
  onClose: () => void;
  onCreate: (title: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const inputId = useId();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);

  const close = () => {
    if (busy) return;
    setTitle("");
    setError(null);
    onClose();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(title.trim());
      setTitle("");
      onClose();
      window.dispatchEvent(new Event("workspace-updated"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not create ${kind}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby={headingId}
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-sm border border-border bg-white p-5 text-text shadow-xl backdrop:bg-black/30"
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id={headingId} className="font-heading text-lg font-medium">New {kind}</h2>
        <button type="button" onClick={close} disabled={busy} aria-label="Close" className="pressable p-1 text-text-muted hover:text-text disabled:opacity-40"><X className="h-4 w-4" /></button>
      </div>
      <form onSubmit={(event) => void submit(event)} className="mt-5 space-y-4">
        <div>
          <label htmlFor={inputId} className="mb-2 block text-sm">{kind === "course" ? "Course" : "Notebook"} title</label>
          <Input id={inputId} autoFocus required maxLength={200} value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)} placeholder={kind === "course" ? "e.g. Computer networks" : "e.g. Lecture notes"} />
        </div>
        {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={close} disabled={busy}>Cancel</Button>
          <Button type="submit" size="sm" disabled={busy || !title.trim()}>{busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}Create {kind}</Button>
        </div>
      </form>
    </dialog>
  );
}
