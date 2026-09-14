"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FileText, LoaderCircle, RefreshCw } from "lucide-react";

import { NotebookWorkspace } from "@/components/notebook-workspace";
import { Button } from "@/components/ui/button";
import type { Notebook } from "@/lib/domain";

/**
 * Full-page notebook route. The notebook is fetched through the
 * course-scoped API route, which validates server-side that the notebook
 * belongs to the course in the URL — a cross-course URL never renders.
 * The section is full-bleed (zero padding-x): padding lives only inside
 * the editor, whose header row and content share the same inner edge.
 * The tutor lives behind a floating circle button; Ask-AI works inline.
 */
export default function NotebookPage() {
  const params = useParams();
  const courseId = typeof params.courseId === "string" ? params.courseId : "";
  const notebookId = typeof params.notebookId === "string" ? params.notebookId : "";
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [courseTitle, setCourseTitle] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadNotebook = useCallback(async () => {
    if (!courseId || !notebookId) return;
    setIsLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const response = await fetch(
        `/api/courses/${encodeURIComponent(courseId)}/notebooks/${encodeURIComponent(notebookId)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as { notebook?: Notebook; error?: string };
      if (response.status === 404 || (!response.ok && !payload.notebook)) {
        setNotFound(true);
        setNotebook(null);
        return;
      }
      if (!response.ok || !payload.notebook) {
        throw new Error(payload.error ?? "The notebook could not be loaded.");
      }
      setNotebook(payload.notebook);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "The notebook could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [courseId, notebookId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadNotebook(), 0);
    return () => window.clearTimeout(timer);
  }, [loadNotebook]);

  // Course title for the breadcrumb only — notebook content never depends on it.
  useEffect(() => {
    if (!courseId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const load = async () => {
        try {
          const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/dashboard`, {
            cache: "no-store",
          });
          if (!response.ok) return;
          const payload = (await response.json()) as { course?: { title: string } };
          if (!cancelled && payload.course) setCourseTitle(payload.course.title);
        } catch {
          // Breadcrumb falls back to "Course".
        }
      };
      void load();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [courseId]);

  if (isLoading && !notebook) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center font-body text-sm text-text-muted">
        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Loading notebook
      </div>
    );
  }

  if (notFound || (loadError && !notebook)) {
    return (
      <main className="px-6 py-7 lg:px-10">
        <div className="border border-dashed border-border-strong px-6 py-12 text-center">
          <FileText className="mx-auto h-8 w-8 text-text-dim" />
          <h1 className="mt-4 font-heading text-xl font-medium tracking-[-0.02em] text-text">
            {notFound ? "This notebook was not found in this course" : "The notebook could not be loaded"}
          </h1>
          <p className="mx-auto mt-2 max-w-sm font-body text-sm leading-6 text-text-muted">
            {notFound
              ? "Notebooks stay inside their course — check the sidebar for where this one lives."
              : (loadError ?? "Try again.")}
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadNotebook()}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
            <Link
              href={`/courses/${courseId}`}
              className="pressable inline-flex h-8 items-center px-2.5 font-body text-xs font-medium text-blue hover:underline"
            >
              Back to course
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!notebook) return null;

  return (
    <main className="min-h-screen bg-bg font-body text-text">
      <section className="pb-7">
        <NotebookWorkspace courseId={courseId} courseTitle={courseTitle} initialNotebook={notebook} />
      </section>
    </main>
  );
}
