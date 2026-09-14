"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { TitleCreationDialog } from "@/components/title-creation-dialog";
import type { Course } from "@/lib/domain";

export function CourseCreator({ onCreated }: { onCreated: (course: Course) => void }) {
  const [open, setOpen] = useState(false);
  const create = async (title: string) => {
    const response = await fetch("/api/courses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, color: "#2d6a4f" }),
    });
    const payload = (await response.json()) as Course | { error: string };
    if (!response.ok || !("id" in payload)) throw new Error("error" in payload ? payload.error : "Could not create course.");
    onCreated({ ...payload, notebooks: [] });
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="pressable p-1.5 text-blue hover:bg-blue-tint" aria-label="Add course" title="Add course"><Plus className="h-4 w-4" /></button>
      <TitleCreationDialog open={open} kind="course" onClose={() => setOpen(false)} onCreate={create} />
    </>
  );
}
