"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { TitleCreationDialog } from "@/components/title-creation-dialog";
import type { Notebook } from "@/lib/domain";

export function NotebookCreator({ courseId, onCreated, label }: { courseId: string; onCreated: (notebook: Notebook) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const create = async (title: string) => {
    const response = await fetch("/api/notebooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ courseId, title }),
    });
    const payload = (await response.json()) as Notebook | { error: string };
    if (!response.ok || !("id" in payload)) throw new Error("error" in payload ? payload.error : "Could not create notebook.");
    onCreated(payload);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          label
            ? "pressable flex w-full items-center gap-1.5 border border-dashed border-border px-2 py-1.5 text-left font-body text-[12px]! leading-[19.5px]! text-text-dim transition-colors hover:bg-bg-alt hover:text-text"
            : "pressable shrink-0 p-1.5 text-blue hover:bg-blue-tint"
        }
        aria-label={label ?? "Add notebook"}
        title={label ?? "Add notebook"}
      >
        <Plus className={label ? "h-3 w-3 shrink-0" : "h-4 w-4"} />
        {label ?? null}
      </button>
      <TitleCreationDialog open={open} kind="notebook" onClose={() => setOpen(false)} onCreate={create} />
    </>
  );
}
