"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, GraduationCap, LoaderCircle, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type QueueItem =
  | {
      key: string;
      kind: "flashcard";
      artifactId: string;
      notebookId: string | null;
      cardId: string;
      front: string;
      topicKey: string;
      lastRating: string | null;
      nextReviewAt: string | null;
      isNew: boolean;
    }
  | {
      key: string;
      kind: "wrong-question";
      artifactId: string;
      notebookId: string | null;
      questionId: string;
      prompt: string;
      explanation: string;
      topicKey: string;
      submittedAt: string;
    }
  | { key: string; kind: "weak-topic"; topicKey: string; displayLabel: string; score: number; evidenceCount: number }
  | {
      key: string;
      kind: "misconception";
      id: string;
      topicKey: string;
      claim: string;
      correction: string;
      evidenceCount: number;
    };

type QueueResponse = {
  items: QueueItem[];
  counts: { flashcards: number; wrongQuestions: number; weakTopics: number; misconceptions: number };
};



/** Course review summary. Cards open in their existing deck or notebook. */
export function ReviewQueue({
  courseId,
  onStartStudy,
}: {
  courseId: string;
  onOpenNotebook: (notebookId: string) => void;
  onStartStudy: () => void;
}) {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [counts, setCounts] = useState<QueueResponse["counts"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [itemError, setItemError] = useState<{ key: string; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/review/today?courseId=${encodeURIComponent(courseId)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as QueueResponse & { error?: string };
      if (!response.ok || !Array.isArray(payload.items)) {
        throw new Error(payload.error ?? "The review queue could not be loaded.");
      }
      setItems(payload.items);
      setCounts(payload.counts);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The review queue could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const update = () => void load();
    window.addEventListener("focus", update);
    return () => { window.clearTimeout(timer); window.removeEventListener("focus", update); };
  }, [load]);

  const resolveMisconception = async (item: Extract<QueueItem, { kind: "misconception" }>) => {
    if (busyKey) return;
    setBusyKey(item.key);
    setItemError(null);
    try {
      const response = await fetch(`/api/misconceptions/${item.id}/resolve`, { method: "POST" });
      const payload = (await response.json()) as { status?: string; error?: string };
      if (!response.ok || payload.status !== "resolved") {
        throw new Error(payload.error ?? "The misconception could not be resolved.");
      }
      setItems((current) => current.filter((entry) => entry.key !== item.key));
    } catch (resolveError) {
      setItemError({
        key: item.key,
        message: resolveError instanceof Error ? resolveError.message : "The misconception could not be resolved.",
      });
    } finally {
      setBusyKey(null);
    }
  };

  // Grouped during render (no reset effect): queue order is preserved inside
  // each group and every key stays unique.
  const flashcards = items.filter((item) => item.kind === "flashcard");
  const wrongQuestions = items.filter((item) => item.kind === "wrong-question");
  const weakTopics = items.filter((item) => item.kind === "weak-topic");
  const misconceptions = items.filter((item) => item.kind === "misconception");

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
        <div>
          <p className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-blue">
            <GraduationCap className="h-3.5 w-3.5" /> Up next
          </p>
          <h2 className="mt-1 font-heading text-lg font-medium tracking-[-0.02em] text-text">Today&apos;s review</h2>
        </div>
      </div>

      <CardContent className="space-y-5 px-5 py-4">
        {loading && !counts ? (
          <p className="flex items-center gap-2 py-6 font-body text-sm text-text-muted">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Finding your next review
          </p>
        ) : error ? (
          <div className="flex flex-wrap items-center gap-2 border border-[#f2d1cf] bg-[#fff4f3] p-3">
            <AlertCircle className="h-4 w-4 shrink-0 text-[#93443d]" />
            <p className="flex-1 font-body text-xs leading-5 text-[#93443d]">{error}</p>
            <Button type="button" variant="danger" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="border border-dashed border-border-strong px-4 py-8 text-center">
            <CheckCircle2 className="mx-auto h-6 w-6 text-blue" />
            <p className="mt-3 font-heading text-sm font-medium tracking-[-0.01em] text-text">All caught up</p>
            <p className="mx-auto mt-1 max-w-xs font-body text-xs leading-5 text-text-muted">
              Nothing needs review right now. You can keep learning in chat or start a study session.
            </p>
          </div>
        ) : (
          <>
            <section aria-label="Flashcards to review" className="border border-blue/20 bg-blue-tint p-5">
              <p className="font-heading text-3xl font-medium text-blue">{flashcards.length}</p>
              <h3 className="mt-1 text-base font-medium">{flashcards.length === 1 ? "flashcard left to review" : "flashcards left to review"}</h3>
              <p className="mt-1 text-sm text-text-muted">{flashcards.length ? "Open a deck to review your new and due cards." : "No flashcards are due right now."}</p>
              <div className="mt-4 space-y-2">
                {[...new Set(flashcards.map(item => item.artifactId))].map((artifactId, index) => {
                  const cards = flashcards.filter(item => item.artifactId === artifactId);
                  const first = cards[0];
                  return <Link key={artifactId} href={first.notebookId ? `/courses/${courseId}/notebooks/${first.notebookId}` : `/courses/${courseId}/study/${artifactId}`} className="pressable flex flex-wrap items-center justify-between gap-3 border border-blue/20 bg-white px-4 py-3 text-sm text-blue hover:bg-bg-alt">
                    <span>{first.topicKey ? first.topicKey.replace(/[_-]/g, " ") : `Deck ${index + 1}`}<span className="ml-2 text-text-muted">{cards.length} left</span></span><span className="flex shrink-0 items-center gap-2">{first.notebookId ? "Open notebook" : "Review cards"}<ArrowRight className="h-4 w-4" /></span>
                  </Link>;
                })}
              </div>
            </section>

            {wrongQuestions.length > 0 ? (
              <section aria-label="Quiz questions to review" className="border border-blue/20 bg-blue-tint p-5">
                <p className="font-heading text-3xl font-medium text-blue">{wrongQuestions.length}</p>
                <h3 className="mt-1 text-base font-medium">{wrongQuestions.length === 1 ? "quiz question left to review" : "quiz questions left to review"}</h3>
                <p className="mt-1 text-sm text-text-muted">Open a quiz to retry your missed questions.</p>
                <div className="mt-4 space-y-2">
                  {[...new Set(wrongQuestions.map(item => item.artifactId))].map((artifactId, index) => {
                    const questions = wrongQuestions.filter(item => item.artifactId === artifactId);
                    const first = questions[0];
                    return <Link key={artifactId} href={first.notebookId ? `/courses/${courseId}/notebooks/${first.notebookId}` : `/courses/${courseId}/study/${artifactId}`} className="pressable flex flex-wrap items-center justify-between gap-3 border border-blue/20 bg-white px-4 py-3 text-sm text-blue hover:bg-bg-alt">
                      <span>{first.topicKey ? first.topicKey.replace(/[_-]/g, " ") : `Quiz ${index + 1}`}<span className="ml-2 text-text-muted">{questions.length} {questions.length === 1 ? "question" : "questions"} left</span></span><span className="flex shrink-0 items-center gap-2">Open quiz<ArrowRight className="h-4 w-4" /></span>
                    </Link>;
                  })}
                </div>
              </section>
            ) : null}

            {weakTopics.length > 0 ? (
              <section aria-label="Weak topics">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
                  Topics to practice · {weakTopics.length}
                </p>
                <ul className="mt-2 space-y-1.5">
                  {weakTopics.map((item) => (
                    <li key={item.key} className="flex flex-wrap items-center gap-2 border border-border bg-white px-3 py-2.5">
                      <span className="font-mono text-[11px] font-medium text-text">{item.topicKey}</span>
                      <Badge>Keep practicing</Badge>
                      <span className="font-mono text-[11px] text-text-dim">
                        {item.evidenceCount} practice responses
                      </span>
                      <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={onStartStudy}>
                        Study now <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {misconceptions.length > 0 ? (
              <section aria-label="Active misconceptions">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
                  Ideas to revisit · {misconceptions.length}
                </p>
                <ul className="mt-2 space-y-1.5">
                  {misconceptions.map((item) => (
                    <li key={item.key} className="border border-border bg-paper px-3 py-2.5">
                      <p className="font-body text-xs font-semibold leading-5 text-text">
                        {item.claim}
                        <span className="ml-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
                          {item.topicKey.replace(/[_-]/g, " ")}
                        </span>
                      </p>
                      <p className="mt-1 font-body text-xs leading-5 text-text-muted">{item.correction}</p>
                      <div className="mt-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busyKey !== null}
                          onClick={() => void resolveMisconception(item)}
                        >
                          {busyKey === item.key ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          Got it
                        </Button>
                        {itemError?.key === item.key ? (
                          <p className="mt-2 font-body text-xs text-[#a53f34]">{itemError.message}</p>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
