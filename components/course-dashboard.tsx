"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type DashboardState = {
  course: { id: string; title: string; color: string };
  notebooks: Array<{ id: string; title: string; updatedAt: string | null }>;
  sources: Array<{ id: string; title: string; type: string; status: string; updatedAt: string }>;
  sourceCounts: { ready: number; processing: number; failed: number; other: number };
  mastery: Array<{
    topicKey: string;
    label: string;
    displayLabel: string;
    score: number;
    evidenceCount: number;
    lastPracticedAt: string | null;
  }>;
  misconceptions: Array<{ id: string; topicKey: string; claim: string; correction: string; evidenceCount: number }>;
  activity: Array<{ id: string; kind: string; topicKey: string | null; syncStatus: string; createdAt: string }>;
  totals: { attempts: number; reviews: number };
};


const EVENT_LABEL: Record<string, string> = {
  quiz_answer: "Answered a quiz question", quiz_complete: "Completed a quiz",
  flashcard_review: "Reviewed a flashcard", misconception: "Found a topic to revisit",
  preference: "Updated study preferences", study_complete: "Completed a study session",
};

export function CourseDashboard({ courseId }: { courseId: string }) {
  const [state, setState] = useState<DashboardState | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/courses/${courseId}/dashboard`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      setState(await response.json());
      setError(false);
    } catch { setError(true); }
  }, [courseId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const update = () => void load();
    window.addEventListener("focus", update);
    window.addEventListener("workspace-updated", update);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", update);
      window.removeEventListener("workspace-updated", update);
    };
  }, [load]);

  if (!state) return <div className="border border-border p-6 text-sm text-text-muted" role="status">
    {error ? <>Could not load your progress. <Button variant="outline" size="sm" onClick={() => void load()}>Try again</Button></> : <span className="flex items-center gap-2"><LoaderCircle className="h-4 w-4 animate-spin" /> Loading your progress</span>}
  </div>;

  return <div className="space-y-8">
    {error && <p role="status" className="text-sm text-text-muted">Showing your last loaded progress. <button className="text-blue underline" onClick={() => void load()}>Try again</button></p>}
    <div className="grid grid-cols-2 border border-border sm:grid-cols-4">
      {[[state.notebooks.length, "Notebooks"], [state.sourceCounts.ready, "Sources ready"], [state.totals.attempts, "Quiz attempts"], [state.totals.reviews, "Cards reviewed"]].map(([value, label]) =>
        <div key={label} className="border-border p-5 [&:not(:last-child)]:border-r"><p className="font-heading text-3xl tracking-tight">{value}</p><p className="mt-1 text-sm text-text-muted">{label}</p></div>)}
    </div>
    <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <section>
        <h2 className="font-heading text-xl font-medium">Your progress</h2>
        <p className="mt-1 text-sm leading-6 text-text-muted">Based on your quiz answers and flashcard reviews.</p>
        {state.mastery.length === 0 ? <div className="mt-4 border border-dashed border-border p-6 text-sm leading-6 text-text-muted">Try a quiz or review some flashcards. Your topic progress will appear here.</div> :
          <ul className="mt-4 divide-y divide-border border-y border-border">{state.mastery.map(entry => <li key={entry.topicKey} className="py-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">{entry.topicKey.replace(/[_-]/g, " ")}</h3><span className="text-sm text-blue">{entry.evidenceCount < 2 ? "Just started" : entry.displayLabel}</span></div>
            {entry.evidenceCount < 2 ? <p className="mt-2 text-sm text-text-muted">Keep practicing to see how you&apos;re doing on this topic.</p> : <div className="mt-3 h-1.5 bg-paper" role="meter" aria-label={`${entry.topicKey} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(entry.score * 100)} aria-valuetext={entry.displayLabel}><div className="h-full bg-blue" style={{ width: `${Math.round(entry.score * 100)}%` }} /></div>}
          </li>)}</ul>}
      </section>
      <section>
        <h2 className="font-heading text-xl font-medium">Recent activity</h2>
        {state.activity.length === 0 ? <p className="mt-4 text-sm leading-6 text-text-muted">Your completed practice will appear here.</p> : <ul className="mt-4 space-y-4">{state.activity.slice(0, 5).map(event => <li key={event.id} className="border-l-2 border-border pl-4"><p className="text-sm">{EVENT_LABEL[event.kind] ?? "Studied this course"}</p>{event.topicKey && <p className="mt-1 text-sm text-text-muted">{event.topicKey.replace(/[_-]/g, " ")}</p>}<time className="mt-1 block text-xs text-text-dim" dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleDateString(undefined, {month: "short", day: "numeric"})}</time></li>)}</ul>}
      </section>
    </div>
    <section>
      <h2 className="font-heading text-xl font-medium">Your notebooks</h2>
      {state.notebooks.length === 0 ? <p className="mt-3 text-sm text-text-muted">Create a notebook from the sidebar to start taking notes.</p> : <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{state.notebooks.map(notebook => <Link key={notebook.id} href={`/courses/${courseId}/notebooks/${notebook.id}`} className="pressable flex items-center justify-between gap-3 border border-border p-4 text-sm hover:bg-bg-alt"><span className="truncate">{notebook.title}</span><ArrowUpRight className="h-4 w-4 shrink-0 text-blue" /></Link>)}</div>}
    </section>
  </div>;
}
