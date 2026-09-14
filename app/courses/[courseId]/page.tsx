"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeftRight, ChevronRight, FolderOpen, LoaderCircle, RefreshCw } from "lucide-react";

import { CourseChatSlot } from "@/components/course-chat-slot";
import { ManageItemButton } from "@/components/manage-item-button";
import { CourseDashboard } from "@/components/course-dashboard";
import { ReviewQueue } from "@/components/review-queue";
import { SearchPanel } from "@/components/search-panel";
import { SourcesPanel } from "@/components/sources-panel";
import { StudyMode } from "@/components/study-mode";
import { Button } from "@/components/ui/button";
import type { WorkspaceResponse } from "@/lib/domain";

/**
 * Course home opens a fresh chat. Supporting study tools live in Dashboard.
 */
export default function CoursePage() {
  const params = useParams();
  const router = useRouter();
  const courseId = typeof params.courseId === "string" ? params.courseId : "";
  const [data, setData] = useState<WorkspaceResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dashboardTab, setDashboardTab] = useState("overview");
  const [studySignal, setStudySignal] = useState(0);
  const [dashboardCourseId, setDashboardCourseId] = useState<string | null>(null);
  const showDashboard = dashboardCourseId === courseId;

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
    (notebookId: string) => {
      router.push(`/courses/${courseId}/notebooks/${notebookId}`);
    },
    [courseId, router],
  );

  if (isLoading && !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center font-body text-sm text-text-muted">
        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> Loading course
      </div>
    );
  }

  const course = data?.courses.find((entry) => entry.id === courseId) ?? null;

  if (!course) {
    return (
      <main className="px-6 py-7 lg:px-10">
        <div className="border border-dashed border-border-strong px-6 py-12 text-center">
          <h1 className="font-heading text-xl font-medium tracking-[-0.02em] text-text">
            {loadError ? "The course could not be loaded" : "This course was not found"}
          </h1>
          <p className="mx-auto mt-2 max-w-sm font-body text-sm leading-6 text-text-muted">
            {loadError ?? "It may have been removed. Pick another course from the sidebar."}
          </p>
          <div className="mt-5 flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadWorkspace()}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
            <Link
              href="/"
              className="pressable inline-flex h-8 items-center px-2.5 font-body text-xs font-medium text-blue hover:underline"
            >
              Back home
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="h-[100dvh] overflow-y-auto [scrollbar-gutter:stable] bg-bg font-body text-text">
      <section className={`px-6 pb-7 pt-5 lg:px-10 ${showDashboard ? "" : "flex h-full min-h-0 flex-col"}`}>
        <div className="flex shrink-0 items-center justify-between gap-3 bg-bg">
          <div className="flex min-w-0 items-center gap-2 font-body text-xs text-text-dim">
            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
            <Link href="/" className="pressable shrink-0 hover:text-text hover:underline">
              Workspace
            </Link>
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate font-medium text-text">{course.title}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0 whitespace-nowrap"
              aria-pressed={showDashboard}
              onClick={() => setDashboardCourseId(showDashboard ? null : courseId)}
            >
              {showDashboard ? (
                <><ArrowLeftRight className="h-3.5 w-3.5" /> Chat</>
              ) : (
                <><ArrowLeftRight className="h-3.5 w-3.5" /> Dashboard</>
              )}
            </Button>
          </div>
        </div>

        {!showDashboard ? (
          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            <CourseChatSlot key={course.id} courseId={course.id} />
          </div>
        ) : (
        <div className="mt-8 space-y-8">
          <header>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-blue">Course overview</p>
              <ManageItemButton id={course.id} courseId={course.id} kind="course" title={course.title} restore={Boolean(course.archivedAt)} showLabel />
            </div>
            <h1 className="mt-2 font-heading text-3xl font-medium tracking-tight sm:text-4xl">{course.title}</h1>
            <p className="mt-3 text-sm leading-6 text-text-muted">Pick up your review, check your progress, or find something in your course materials.</p>
          </header>
          <nav aria-label="Dashboard sections" className="flex gap-5 overflow-x-auto border-b border-border">
            {[["overview", "Overview"], ["sources", "Course materials"], ["study", "Study session"], ["search", "Search"]].map(([id, label]) => <button key={id} type="button" aria-current={dashboardTab === id ? "page" : undefined} onClick={() => setDashboardTab(id)} className={`pressable shrink-0 border-b-2 pb-3 text-sm ${dashboardTab === id ? "border-blue font-medium text-blue" : "border-transparent text-text-muted hover:text-text"}`}>{label}</button>)}
          </nav>
          {dashboardTab === "overview" && <>
            <ReviewQueue key={`review-${course.id}`} courseId={course.id} onOpenNotebook={openNotebook} onStartStudy={() => { setDashboardTab("study"); setStudySignal(current => current + 1); }} />
            <CourseDashboard key={`dashboard-${course.id}`} courseId={course.id} />
          </>}
          {dashboardTab === "sources" && <SourcesPanel key={`sources-${course.id}`} courseId={course.id} />}
          <div hidden={dashboardTab !== "study"}><StudyMode key={`study-${course.id}`} courseId={course.id} startSignal={studySignal} /></div>
          {dashboardTab === "search" && <SearchPanel key={`search-${course.id}`} courseId={course.id} />}
        </div>
        )}
      </section>
    </main>
  );
}
