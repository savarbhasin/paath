"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronRight, FolderOpen, LoaderCircle, RefreshCw } from "lucide-react";

import { CourseCreator } from "@/components/course-creator";
import { ReviewQueue } from "@/components/review-queue";
import { StudyMode } from "@/components/study-mode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Course, WorkspaceResponse } from "@/lib/domain";

/**
 * Home route: the workspace's course list plus each course's review queue.
 * Navigation is by link — opening anything pushes its route.
 */
export default function HomePage() {
  const router = useRouter();
  const [data, setData] = useState<WorkspaceResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadWorkspace = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/workspace", { cache: "no-store" });
      const payload = (await response.json()) as WorkspaceResponse | { error: string };
      if (!response.ok || !("workspace" in payload)) {
        throw new Error("error" in payload ? payload.error : "Could not load the workspace.");
      }
      setData(payload);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load the workspace.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkspace(), 0);
    const reload = () => void loadWorkspace();
    window.addEventListener("workspace-updated", reload);
    return () => { window.clearTimeout(timer); window.removeEventListener("workspace-updated", reload); };
  }, [loadWorkspace]);

  const openNotebook = useCallback(
    (courseId: string, notebookId: string) => {
      router.push(`/courses/${courseId}/notebooks/${notebookId}`);
    },
    [router],
  );

  if (isLoading && !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center font-body text-sm text-text-muted">
        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Loading your workspace
      </div>
    );
  }

  if (loadError && !data) {
    return (
      <main className="flex min-h-[60vh] items-center justify-center p-6">
        <Card className="max-w-lg">
          <CardContent className="p-8">
            <h1 className="font-heading text-xl font-medium tracking-[-0.02em]">
              Connect the learning workspace
            </h1>
            <p className="mt-2 font-body text-sm leading-6 text-text-muted">
              The app could not reach Supabase. Apply the migration, then add the server values from{" "}
              <code className="bg-blue-tint px-1.5 py-0.5 font-mono text-xs">.env.example</code>. The
              browser never receives the service key.
            </p>
            <p className="mt-4 border border-border bg-paper p-3 font-mono text-xs leading-5 text-text-muted">
              {loadError}
            </p>
            <Button className="mt-5" onClick={() => void loadWorkspace()}>
              <RefreshCw className="h-4 w-4" /> Try again
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const courses = data?.courses.filter(course => !course.archivedAt) ?? [];

  return (
    <main className="min-h-screen bg-bg font-body text-text">
      <section className="px-6 py-7 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 font-body text-xs text-text-dim">
              <FolderOpen className="h-3.5 w-3.5" /> Workspace
            </div>
            <h1 className="mt-3 font-heading text-3xl font-medium tracking-[-0.04em] text-text">
              {data?.workspace.name ?? "My learning space"}
            </h1>
            <p className="mt-2 max-w-xl font-body text-sm leading-6 text-text-muted">
              Pick a course to start a chat, or work today&apos;s review queue here.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void loadWorkspace()} disabled={isLoading}>
            <RefreshCw className={isLoading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Refresh
          </Button>
        </div>

        <div className="mt-9 flex items-center justify-between">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">Courses</p>
          <CourseCreator
            onCreated={(course) =>
              setData((current) => (current ? { ...current, courses: [...current.courses, course] } : current))
            }
          />
        </div>

        {courses.length === 0 ? (
          <Card className="mt-3">
            <CardContent className="flex flex-col items-start gap-5 p-8">
              <div className="flex h-12 w-12 items-center justify-center bg-blue text-white">
                <BookOpen className="h-6 w-6" />
              </div>
              <div>
                <h2 className="font-heading text-lg font-medium tracking-[-0.02em]">
                  Your first course starts here
                </h2>
                <p className="mt-1 font-body text-sm text-text-muted">
                  Create a course, then add a notebook for the material you are learning.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <ul className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {courses.map((course) => (
              <li key={course.id}>
                <Link
                  href={`/courses/${course.id}`}
                  className="pressable group flex h-full flex-col border border-border bg-white p-5 transition-colors hover:border-border-strong hover:bg-paper"
                >
                  <span className="flex items-center gap-3">
                    <span className="h-2.5 w-2.5 shrink-0" style={{ backgroundColor: course.color }} />
                    <span className="min-w-0 flex-1 truncate font-heading text-lg font-medium tracking-[-0.02em] text-text">
                      {course.title}
                    </span>
                    <Badge>{course.notebooks.length}</Badge>
                  </span>
                  <span className="mt-2 font-body text-sm leading-6 text-text-muted">
                    {course.notebooks.length === 0
                      ? "No notebooks yet — open the course to start one."
                      : course.notebooks.slice(0, 3).map((notebook) => notebook.title).join(" · ")}
                  </span>
                  <span className="mt-4 inline-flex items-center gap-1 font-body text-sm font-medium text-blue">
                    Open course
                    <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {courses.length > 0 ? (
          <div className="mt-10">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
              Today&apos;s review
            </p>
            <div className="mt-3 space-y-6">
              {courses.map((course) => (
                <HomeCourseReview key={course.id} course={course} onOpenNotebook={openNotebook} />
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function HomeCourseReview({
  course,
  onOpenNotebook,
}: {
  course: Course;
  onOpenNotebook: (courseId: string, notebookId: string) => void;
}) {
  const [studySignal, setStudySignal] = useState(0);

  return (
    <section aria-label={`Review for ${course.title}`}>
      <div className="mb-3 flex items-center gap-2">
        <span className="h-2 w-2 shrink-0" style={{ backgroundColor: course.color }} />
        <h2 className="font-heading text-base font-medium tracking-[-0.01em] text-text">{course.title}</h2>
        <Link
          href={`/courses/${course.id}`}
          className="pressable ml-auto inline-flex items-center gap-1 font-body text-xs font-medium text-blue hover:underline"
        >
          Course page <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="grid items-stretch gap-6 lg:grid-cols-2">
        <ReviewQueue
          key={`review-${course.id}`}
          courseId={course.id}
          onOpenNotebook={(notebookId) => onOpenNotebook(course.id, notebookId)}
          onStartStudy={() => setStudySignal((current) => current + 1)}
        />
        <StudyMode key={`study-${course.id}`} courseId={course.id} startSignal={studySignal} />
      </div>
    </section>
  );
}
