"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Archive, ChevronDown, ChevronRight, FileText, House, LoaderCircle } from "lucide-react";

import { NotebookCreator } from "@/components/notebook-creator";
import { ManageItemButton } from "@/components/manage-item-button";
import { CourseCreator } from "@/components/course-creator";
import { CourseArtifactLinks } from "@/components/course-artifact-links";
import type { Course, WorkspaceResponse } from "@/lib/domain";
import { cn } from "@/lib/utils";

function routeIds(params: ReturnType<typeof useParams>): { courseId: string | null; notebookId: string | null; artifactId: string | null } {
  const courseId = params.courseId;
  const notebookId = params.notebookId;
  const artifactId = params.artifactId;
  return {
    courseId: typeof courseId === "string" ? courseId : null,
    notebookId: typeof notebookId === "string" ? notebookId : null,
    artifactId: typeof artifactId === "string" ? artifactId : null,
  };
}

/**
 * App-wide sidebar. What's open derives from route params (the expanded
 * course is the one in the URL) — no lifted selection state. Clicking a
 * course navigates to its page and expands its notebooks; clicking a
 * notebook title navigates to the notebook route.
 */
export function AppSidebar() {
  const params = useParams();
  const router = useRouter();
  const { courseId: activeCourseId, notebookId: activeNotebookId, artifactId: activeArtifactId } = routeIds(params);
  const [data, setData] = useState<WorkspaceResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [manualExpanded, setManualExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
        try {
          const response = await fetch("/api/workspace", { cache: "no-store" });
          const payload = (await response.json()) as WorkspaceResponse | { error: string };
          if (!response.ok || !("workspace" in payload)) throw new Error();
          if (!cancelled) {
            setData(payload);
            setFailed(false);
          }
        } catch {
          if (!cancelled) setFailed(true);
        }
    };
    const reload = () => void load();
    const timer = window.setTimeout(reload, 0);
    window.addEventListener("workspace-updated", reload);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("workspace-updated", reload);
    };
  }, []);

  const handleCourseCreated = useCallback((course: Course) => {
    setData((current) => (current ? { ...current, courses: [...current.courses, course] } : current));
  }, []);

  return (
    <aside className="sticky top-0 flex h-screen w-[292px] shrink-0 flex-col overflow-y-auto border-r border-border bg-bg px-5 py-6">
      <Link href="/" aria-label="Paath home" className="pressable flex items-center px-2 py-1">
        <span className="min-w-0">
          <span className="block font-brand text-[30px] font-semibold leading-none tracking-[-0.045em] text-blue">Paath</span>
          <span className="mt-2 block font-body text-[11px] leading-4 text-text-muted">Your space to study deeply.</span>
        </span>
      </Link>

      <nav className="mt-9 space-y-1" aria-label="Primary">
        <Link
          href="/"
          aria-current={activeCourseId === null ? "page" : undefined}
          className={cn(
            "pressable flex w-full items-center gap-3 border px-3 py-3 text-left text-sm font-medium tracking-[-0.005em] transition-colors",
            activeCourseId === null
              ? "border-blue/25 bg-blue/[0.08] text-text"
              : "border-transparent text-text-muted hover:bg-bg-alt hover:text-text",
          )}
        >
          <House className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Home</span>
        </Link>
      </nav>

      <div className="mt-7 flex items-center justify-between px-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">Courses</p>
        <CourseCreator onCreated={handleCourseCreated} />
      </div>

      <nav className="mt-3 space-y-1" aria-label="Courses">
        {data ? (
          data.courses.filter(course => !course.archivedAt).map((course) => {
            const expanded = manualExpanded[course.id] ?? activeCourseId === course.id;
            return (
              <div key={course.id}>
                <div
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2.5 border px-2.5 py-2.5 text-left transition-colors",
                    expanded
                      ? "border-blue/25 bg-blue/[0.08] text-text"
                      : "border-transparent text-text-muted hover:bg-bg-alt hover:text-text",
                  )}
                >
                  <span
                    className="h-2 w-2 shrink-0"
                    style={{ backgroundColor: expanded ? "#2d6a4f" : course.color }}
                  />
                  <Link
                    href={`/courses/${course.id}`}
                    onClick={() => setManualExpanded((current) => ({ ...current, [course.id]: true }))}
                    aria-current={expanded && activeNotebookId === null && activeArtifactId === null ? "page" : undefined}
                    className="min-w-0 flex-1 truncate text-sm font-medium tracking-[-0.005em]"
                  >
                    {course.title}
                  </Link>
                  <span className="font-mono text-[11px] text-text-dim">{course.notebooks.length}</span>
                  <button
                    type="button"
                    onClick={() => setManualExpanded((current) => ({ ...current, [course.id]: !expanded }))}
                    aria-expanded={expanded}
                    aria-label={expanded ? `Collapse ${course.title}` : `Expand ${course.title} notebooks, practice, and videos`}
                    title={expanded ? "Collapse" : "Show notebooks, practice, and videos"}
                    className="pressable shrink-0 p-0.5 text-text-dim transition-colors hover:text-text"
                  >
                    {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                </div>
                {expanded ? (
                  <>
                  <ul className="ml-4 mt-1 space-y-0.5 border-l border-border py-0.5 pl-1.5" aria-label={`${course.title} notebooks`}>
                    {course.notebooks.map((notebook) => {
                      const active = activeNotebookId === notebook.id;
                      return (
                        <li key={notebook.id} className="flex min-w-0 items-center">
                          <Link
                            href={`/courses/${course.id}/notebooks/${notebook.id}`}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "pressable flex w-full items-start gap-1.5 border px-2 py-1.5 text-left font-body text-[13px] transition-colors",
                              active
                                ? "border-transparent bg-blue-tint text-text"
                                : "border-transparent text-text-muted hover:bg-bg-alt hover:text-text",
                            )}
                          >
                            <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span className="min-w-0 truncate">{notebook.title}</span>
                          </Link>
                        </li>
                      );
                    })}
                    {course.notebooks.length === 0 ? (
                      <li className="px-2 py-1.5 font-body text-xs leading-5 text-text-dim">
                        No notebooks yet.
                      </li>
                    ) : null}
                    <li className="pt-1.5">
                      <NotebookCreator courseId={course.id} label="New notebook" onCreated={(notebook) => router.push(`/courses/${course.id}/notebooks/${notebook.id}`)} />
                    </li>
                  </ul>
                  <CourseArtifactLinks courseId={course.id} activeArtifactId={expanded ? activeArtifactId : null} />
                  </>
                ) : null}
              </div>
            );
          })
        ) : (
          <p className="flex items-center gap-2 px-3 py-3 font-body text-sm text-text-muted">
            {failed ? (
              "Courses could not be loaded."
            ) : (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" /> Loading courses
              </>
            )}
          </p>
        )}
        {data && data.courses.length === 0 ? (
          <p className="px-3 py-3 font-body text-sm text-text-muted">Create your first course.</p>
        ) : null}
      </nav>

      <div className="mt-auto px-2 pt-6">
        <div className="mt-3 border border-border bg-paper p-4">
          <p className="font-heading text-xs font-medium tracking-[-0.01em] text-text">One place for the work</p>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            Courses keep notebooks separate, so every idea stays with the material it belongs to.
          </p>
        </div>
        {data?.courses.some(course => course.archivedAt) ? (
          <details className="group mt-4 border-t border-border pt-3 text-text-muted">
            <summary className="pressable flex cursor-pointer list-none items-center gap-2 px-2 py-2 text-xs font-medium transition-colors hover:bg-bg-alt hover:text-text [&::-webkit-details-marker]:hidden">
              <Archive className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1">Archived courses</span>
              <span className="font-mono text-[10px] text-text-dim">{data.courses.filter(course => course.archivedAt).length}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" />
            </summary>
            <ul className="mt-2 space-y-1" aria-label="Archived courses">
              {data.courses.filter(course => course.archivedAt).map(course => (
                <li key={course.id} className="flex min-w-0 items-center gap-2 border border-border bg-paper px-2 py-2">
                  <span className="h-2 w-2 shrink-0" style={{ backgroundColor: course.color }} />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-text" title={course.title}>{course.title}</span>
                  <ManageItemButton id={course.id} courseId={course.id} kind="course" title={course.title} restore />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </aside>
  );
}
