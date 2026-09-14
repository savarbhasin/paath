"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  Eye,
  EyeOff,
  LoaderCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { REVIEW_RATING_LABEL, type ReviewRating } from "@/lib/study";
import { cn } from "@/lib/utils";

type StudyCard = { artifactId: string; cardId: string; front: string; back: string; topicKey: string };
type StudyQuestion = {
  id: string;
  type: "single" | "multi";
  prompt: string;
  options: Array<{ id: string; text: string }>;
  explanation: string;
  topicKey: string;
};

type StudyStep = {
  key: string;
  kind: "recap" | "flashcards" | "practice" | "result";
  status: "pending" | "active" | "complete" | "skipped";
  artifactId: string | null;
  cardRefs: string[];
  questionIds: string[];
  title: string;
  detail: string;
  cards: StudyCard[];
  questions: StudyQuestion[];
};

type StudySession = {
  id: string;
  courseId: string;
  status: "active" | "completed" | "abandoned";
  steps: StudyStep[];
  startedAt: string;
  completedAt: string | null;
};

type PracticeResult = {
  questionId: string;
  correct: boolean;
  expected: string[];
  received: string[];
  topicKey: string;
  explanation: string;
};

const RATINGS: ReviewRating[] = ["again", "hard", "good", "easy"];

const STEP_LABEL: Record<StudyStep["kind"], string> = {
  recap: "Recap",
  flashcards: "Flashcards",
  practice: "Practice",
  result: "Result",
};

/**
 * Ticket 07 Study Mode. One persisted recap → flashcards → practice → result
 * sequence per course. Scoring reuses the existing flashcard review and
 * assessment submit routes — the session only tracks step progress — and
 * completion writes a single `study_complete` memory event with duplicate
 * protection. Reloading resumes the same session from the server.
 */
export function StudyMode({ courseId, startSignal }: { courseId: string; startSignal: number }) {
  const [session, setSession] = useState<StudySession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [completedNote, setCompletedNote] = useState<string | null>(null);

  const [ratedCards, setRatedCards] = useState<Record<string, ReviewRating>>({});
  const [revealedCard, setRevealedCard] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [practiceScore, setPracticeScore] = useState<{ sessionId: string; score: number; results: PracticeResult[] } | null>(null);

  // Seeding + external-start bookkeeping live in refs and stable string keys
  // so no effect body sets state synchronously and no fresh object identity
  // lands in a dep array.
  const [seededKey, setSeededKey] = useState<string | null>(null);
  const handledStartSignal = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/study-sessions?courseId=${encodeURIComponent(courseId)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as { session?: StudySession | null; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The study session could not be loaded.");
      setSession(payload.session ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The study session could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const start = useCallback(async () => {
    setBusy("start");
    setActionError(null);
    setCompletedNote(null);
    try {
      const response = await fetch("/api/study-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId }),
      });
      const payload = (await response.json()) as { session?: StudySession; error?: string };
      if (!response.ok || !payload.session) throw new Error(payload.error ?? "The study session could not be started.");
      setSession(payload.session);
      setRatedCards({});
      setAnswers({});
      setPracticeScore(null);
    } catch (startError) {
      setActionError(startError instanceof Error ? startError.message : "The study session could not be started.");
    } finally {
      setBusy(null);
    }
  }, [courseId]);

  // External "Study now" requests (e.g. from the review queue) start or
  // resume the session. Runs in the async continuation, never synchronously.
  useEffect(() => {
    if (startSignal <= 0 || handledStartSignal.current === startSignal) return;
    handledStartSignal.current = startSignal;
    const timer = window.setTimeout(() => void start(), 0);
    return () => window.clearTimeout(timer);
  }, [startSignal, start]);

  const advance = useCallback(async (sessionId: string, stepKey: string, status: "complete" | "skipped") => {
    setBusy(`advance:${stepKey}`);
    setActionError(null);
    try {
      const response = await fetch(`/api/study-sessions/${sessionId}/advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stepKey, status }),
      });
      const payload = (await response.json()) as { session?: StudySession; error?: string };
      if (!response.ok || !payload.session) throw new Error(payload.error ?? "The step could not be updated.");
      setSession(payload.session);
    } catch (advanceError) {
      setActionError(advanceError instanceof Error ? advanceError.message : "The step could not be updated.");
    } finally {
      setBusy(null);
    }
  }, []);

  const complete = useCallback(async (sessionId: string) => {
    setBusy("complete");
    setActionError(null);
    try {
      const response = await fetch(`/api/study-sessions/${sessionId}/complete`, { method: "POST" });
      const payload = (await response.json()) as {
        session?: StudySession;
        alreadyCompleted?: boolean;
        memoryWarning?: string;
        error?: string;
      };
      if (!response.ok || !payload.session) throw new Error(payload.error ?? "The session could not be completed.");
      setSession(payload.session);
      setCompletedNote(
        payload.alreadyCompleted
          ? "This session was already completed — nothing was written twice."
          : payload.memoryWarning ?? "Session completed. Memory recorded it once.",
      );
    } catch (completeError) {
      setActionError(completeError instanceof Error ? completeError.message : "The session could not be completed.");
    } finally {
      setBusy(null);
    }
  }, []);

  // The current step is derived during render: the first active step, or the
  // first pending one when the server has not activated it yet.
  const currentStep = session?.status === "active"
    ? (session.steps.find((step) => step.status === "active") ?? session.steps.find((step) => step.status === "pending") ?? null)
    : null;

  // Seed cards rated during this session so a reload resumes with rated
  // cards checked off. Only reviews at or after the session start count — an
  // older review is exactly why a card is due again. Stable string keys only.
  const flashcardsStep = session?.steps.find((step) => step.kind === "flashcards") ?? null;
  const deckIdsKey = flashcardsStep ? [...new Set(flashcardsStep.cards.map((card) => card.artifactId))].sort().join(",") : "";
  const sessionStartedAt = session?.startedAt ?? "";
  const seedKey = session && flashcardsStep && currentStep?.kind === "flashcards" ? `${session.id}:flashcards` : null;
  useEffect(() => {
    if (!seedKey || !deckIdsKey || !sessionStartedAt || seededKey === seedKey) return;
    const artifactIds = deckIdsKey.split(",").filter((id) => id.length > 0);
    const startedAt = sessionStartedAt;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const seed = async () => {
        try {
          const found: Record<string, ReviewRating> = {};
          for (const artifactId of artifactIds) {
            const response = await fetch(`/api/flashcards/${artifactId}/reviews`, { cache: "no-store" });
            if (!response.ok) continue;
            const payload = (await response.json()) as {
              reviews?: Array<{ cardId: string; rating: ReviewRating; reviewedAt: string }>;
            };
            for (const review of payload.reviews ?? []) {
              if (!(RATINGS as string[]).includes(review.rating)) continue;
              if (typeof review.reviewedAt !== "string" || review.reviewedAt < startedAt) continue;
              found[`${artifactId}:${review.cardId}`] = review.rating;
            }
          }
          if (!cancelled) {
            if (Object.keys(found).length > 0) setRatedCards((current) => ({ ...found, ...current }));
            setSeededKey(seedKey);
          }
        } catch {
          if (!cancelled) setSeededKey(seedKey);
        }
      };
      void seed();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [seedKey, deckIdsKey, sessionStartedAt, seededKey]);

  const rateStudyCard = async (card: StudyCard, rating: ReviewRating) => {
    const ref = `${card.artifactId}:${card.cardId}`;
    if (busy) return;
    setBusy(`rate:${ref}`);
    setActionError(null);
    try {
      const response = await fetch(`/api/flashcards/${card.artifactId}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId: card.cardId, rating }),
      });
      const payload = (await response.json()) as { review?: unknown; error?: string };
      if (!response.ok || !payload.review) throw new Error(payload.error ?? "The review could not be saved.");
      setRatedCards((current) => ({ ...current, [ref]: rating }));
    } catch (rateError) {
      setActionError(rateError instanceof Error ? rateError.message : "The review could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  const toggleOption = (questionId: string, optionId: string, type: "single" | "multi") => {
    setActionError(null);
    setAnswers((current) => {
      if (type === "single") return { ...current, [questionId]: [optionId] };
      const selected = current[questionId] ?? [];
      return {
        ...current,
        [questionId]: selected.includes(optionId)
          ? selected.filter((id) => id !== optionId)
          : [...selected, optionId],
      };
    });
  };

  const submitPractice = async (step: StudyStep) => {
    if (!step.artifactId || busy) return;
    setBusy("practice-submit");
    setActionError(null);
    try {
      const response = await fetch(`/api/assessments/${step.artifactId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const payload = (await response.json()) as {
        attempt?: { score: number; results: PracticeResult[] };
        error?: string;
      };
      if (!response.ok || !payload.attempt) throw new Error(payload.error ?? "The submission could not be saved.");
      if (session) setPracticeScore({ sessionId: session.id, score: payload.attempt.score, results: payload.attempt.results });
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : "The submission could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  const practiceResult = practiceScore && session && practiceScore.sessionId === session.id ? practiceScore : null;

  return (
    <Card id="study-mode">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
        <div>
          <p className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-blue">
            <BookOpenCheck className="h-3.5 w-3.5" /> Study Mode
          </p>
          <h2 className="mt-1 font-heading text-lg font-medium tracking-[-0.02em] text-text">Guided session</h2>
        </div>
        {session?.status === "active" ? null : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy === "start"}
            className="pressable flex h-11 items-stretch overflow-hidden border border-blue bg-blue text-white transition-colors hover:bg-blue-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex flex-1 items-center justify-center px-5 font-body text-[14.5px] font-medium">
              {busy === "start" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : session ? "Start new session" : "Start session"}
            </span>
            <span className="flex w-11 items-center justify-center border-l border-white/20">
              <ArrowRight className="h-4 w-4" />
            </span>
          </button>
        )}
      </div>

      <CardContent className="px-5 py-4">
        {loading && !session ? (
          <p className="flex items-center gap-2 py-6 font-body text-sm text-text-muted">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Checking for an active session
          </p>
        ) : error && !session ? (
          <div className="flex flex-wrap items-center gap-2 border border-[#f2d1cf] bg-[#fff4f3] p-3">
            <AlertCircle className="h-4 w-4 shrink-0 text-[#93443d]" />
            <p className="flex-1 font-body text-xs leading-5 text-[#93443d]">{error}</p>
            <Button type="button" variant="danger" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        ) : !session ? (
          <p className="border border-dashed border-border-strong px-4 py-6 text-center font-body text-sm leading-6 text-text-muted">
            A short guided sequence: recap, flashcards, practice, result. Leaving mid-way is fine — it resumes here.
          </p>
        ) : (
          <>
            <ol className="flex flex-wrap gap-1.5" aria-label="Session steps">
              {session.steps.map((step) => (
                <li key={step.key}>
                  <Badge
                    className={cn(
                      step.status === "complete" && "border-blue/25 bg-blue text-white",
                      step.status === "active" && "border-blue/25 bg-blue-tint text-blue",
                      step.status === "skipped" && "opacity-60",
                    )}
                  >
                    {STEP_LABEL[step.kind]}
                    {step.status === "complete" ? " ✓" : step.status === "skipped" ? " — skipped" : ""}
                  </Badge>
                </li>
              ))}
            </ol>

            {session.status === "completed" ? (
              <div className="mt-3 border border-blue/25 bg-blue-tint px-4 py-3">
                <p className="flex items-center gap-1.5 font-body text-sm font-semibold text-text">
                  <CheckCircle2 className="h-4 w-4 text-blue" /> Session completed
                </p>
                {completedNote ? <p className="mt-1 font-body text-xs leading-5 text-blue">{completedNote}</p> : null}
                <p className="mt-1 font-body text-xs leading-5 text-text-muted">
                  Quiz, review, and mastery records updated through the normal routes while you worked the steps.
                </p>
              </div>
            ) : currentStep ? (
              <div className="mt-3">
                {currentStep.kind === "recap" ? (
                  <RecapStep step={currentStep} busy={busy} onContinue={() => void advance(session.id, currentStep.key, "complete")} />
                ) : null}
                {currentStep.kind === "flashcards" ? (
                  <FlashcardsStep
                    step={currentStep}
                    busy={busy}
                    ratedCards={ratedCards}
                    revealedCard={revealedCard}
                    onReveal={setRevealedCard}
                    onRate={(card, rating) => void rateStudyCard(card, rating)}
                    onContinue={() => void advance(session.id, currentStep.key, "complete")}
                  />
                ) : null}
                {currentStep.kind === "practice" ? (
                  <PracticeStep
                    step={currentStep}
                    busy={busy}
                    answers={answers}
                    result={practiceResult}
                    onToggle={toggleOption}
                    onSubmit={() => void submitPractice(currentStep)}
                    onContinue={() => void advance(session.id, currentStep.key, "complete")}
                  />
                ) : null}
                {currentStep.kind === "result" ? (
                  <div className="border border-border bg-white px-4 py-4">
                    <p className="font-heading text-base font-medium tracking-[-0.01em] text-text">Wrap up</p>
                    <p className="mt-1 font-body text-sm leading-6 text-text-muted">
                      {resultSummary(session, Object.keys(ratedCards).length, practiceResult?.score ?? null)}
                    </p>
                    <button
                      type="button"
                      onClick={() => void complete(session.id)}
                      disabled={busy === "complete"}
                      className="pressable mt-3 flex h-11 items-stretch overflow-hidden border border-blue bg-blue text-white transition-colors hover:bg-blue-hover disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="flex flex-1 items-center justify-center px-5 font-body text-[14.5px] font-medium">
                        {busy === "complete" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "Complete session"}
                      </span>
                      <span className="flex w-11 items-center justify-center border-l border-white/20">
                        <CheckCircle2 className="h-4 w-4" />
                      </span>
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {actionError ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 border border-[#f2d1cf] bg-[#fff4f3] p-3">
                <AlertCircle className="h-4 w-4 shrink-0 text-[#93443d]" />
                <p className="flex-1 font-body text-xs leading-5 text-[#93443d]">{actionError} Nothing was lost — try again.</p>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RecapStep({ step, busy, onContinue }: { step: StudyStep; busy: string | null; onContinue: () => void }) {
  return (
    <div className="border border-border bg-white px-4 py-4">
      <p className="font-heading text-base font-medium tracking-[-0.01em] text-text">Recap</p>
      <p className="mt-2 whitespace-pre-wrap font-body text-sm leading-6 text-text-muted">{step.detail}</p>
      <Button type="button" className="mt-3" disabled={busy !== null} onClick={onContinue}>
        {busy === `advance:${step.key}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
        Continue to flashcards <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

function FlashcardsStep({
  step,
  busy,
  ratedCards,
  revealedCard,
  onReveal,
  onRate,
  onContinue,
}: {
  step: StudyStep;
  busy: string | null;
  ratedCards: Record<string, ReviewRating>;
  revealedCard: string | null;
  onReveal: (ref: string | null) => void;
  onRate: (card: StudyCard, rating: ReviewRating) => void;
  onContinue: () => void;
}) {
  const ratedCount = step.cards.filter((card) => ratedCards[`${card.artifactId}:${card.cardId}`]).length;
  const allRated = step.cards.length > 0 && ratedCount === step.cards.length;

  return (
    <div className="border border-border bg-white px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-heading text-base font-medium tracking-[-0.01em] text-text">Flashcards</p>
        <Badge>
          {ratedCount} of {step.cards.length} rated
        </Badge>
      </div>
      {step.cards.length === 0 ? (
        <p className="mt-2 font-body text-sm leading-6 text-text-muted">No cards in this step — continue when ready.</p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {step.cards.map((card) => {
            const ref = `${card.artifactId}:${card.cardId}`;
            const rating = ratedCards[ref];
            return (
              <li key={ref} className="border border-border bg-paper px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] font-medium text-text">{card.topicKey}</span>
                  {rating ? (
                    <Badge className="border-blue/25 bg-blue-tint text-blue">Rated {REVIEW_RATING_LABEL[rating]}</Badge>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onReveal(revealedCard === ref ? null : ref)}
                    className="pressable ml-auto inline-flex items-center gap-1 font-body text-xs text-text-muted hover:text-text"
                    aria-expanded={revealedCard === ref}
                  >
                    {revealedCard === ref ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {revealedCard === ref ? "Hide" : "Reveal"}
                  </button>
                </div>
                <p className="mt-1.5 font-body text-sm font-medium leading-6 text-text">{card.front}</p>
                {revealedCard === ref ? (
                  <p className="mt-2 border-t border-border pt-2 font-body text-sm leading-6 text-text-muted">{card.back}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`Rate card on ${card.topicKey}`}>
                  {RATINGS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => onRate(card, option)}
                      aria-pressed={rating === option}
                      className={cn(
                        "pressable inline-flex h-8 items-center gap-1.5 border px-2.5 font-body text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                        rating === option
                          ? "border-blue bg-blue text-white"
                          : "border-border bg-white text-text-muted hover:bg-bg-alt hover:text-text",
                      )}
                    >
                      {busy === `rate:${ref}` ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                      {REVIEW_RATING_LABEL[option]}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <Button type="button" variant="outline" className="mt-3" disabled={busy !== null || !allRated && step.cards.length > 0} onClick={onContinue}>
        {busy === `advance:${step.key}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
        Continue to practice <ArrowRight className="h-4 w-4" />
      </Button>
      {step.cards.length > 0 && !allRated ? (
        <span className="ml-2 font-body text-xs text-text-dim">Rate every card to continue.</span>
      ) : null}
    </div>
  );
}

function PracticeStep({
  step,
  busy,
  answers,
  result,
  onToggle,
  onSubmit,
  onContinue,
}: {
  step: StudyStep;
  busy: string | null;
  answers: Record<string, string[]>;
  result: { score: number; results: PracticeResult[] } | null;
  onToggle: (questionId: string, optionId: string, type: "single" | "multi") => void;
  onSubmit: () => void;
  onContinue: () => void;
}) {
  const answeredCount = step.questions.filter((question) => (answers[question.id] ?? []).length > 0).length;
  const allAnswered = step.questions.length > 0 && answeredCount === step.questions.length;

  return (
    <div className="border border-border bg-white px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-heading text-base font-medium tracking-[-0.01em] text-text">Practice</p>
        {result ? (
          <Badge className="border-blue/25 bg-blue-tint text-blue">
            {Math.round(result.score * 100)}% · {result.results.filter((entry) => entry.correct).length} of {result.results.length} correct
          </Badge>
        ) : (
          <Badge>
            {answeredCount} of {step.questions.length} answered
          </Badge>
        )}
      </div>
      {step.questions.length === 0 ? (
        <p className="mt-2 font-body text-sm leading-6 text-text-muted">No practice questions in this step — continue when ready.</p>
      ) : result ? (
        <ul className="mt-3 space-y-2">
          {result.results.map((entry, index) => (
            <li key={entry.questionId} className="border border-border bg-paper px-3.5 py-3">
              <p className="flex items-center gap-1.5 font-body text-xs font-semibold text-text">
                {entry.correct ? <CheckCircle2 className="h-3.5 w-3.5 text-blue" /> : <XCircle className="h-3.5 w-3.5 text-[#a53f34]" />}
                Q{index + 1} · {entry.correct ? "Correct" : "Incorrect"}
                <span className="ml-auto font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
                  {entry.topicKey}
                </span>
              </p>
              <p className="mt-1.5 font-body text-xs leading-5 text-text-muted">{entry.explanation}</p>
            </li>
          ))}
        </ul>
      ) : (
        <ol className="mt-3 space-y-2.5">
          {step.questions.map((question, index) => {
            const selected = answers[question.id] ?? [];
            return (
              <li key={question.id} className="border border-border bg-paper px-3.5 py-3">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
                  Q{index + 1} · {question.type === "single" ? "Single choice" : "Multi-select"} · {question.topicKey}
                </p>
                <p className="mt-1.5 font-body text-sm font-medium leading-6 text-text">{question.prompt}</p>
                <div className="mt-2 space-y-1.5">
                  {question.options.map((option) => {
                    const active = selected.includes(option.id);
                    return (
                      <label
                        key={option.id}
                        className={cn(
                          "pressable flex cursor-pointer items-start gap-2.5 border px-3 py-2.5 font-body text-sm transition-colors",
                          active ? "border-blue bg-blue-tint text-text" : "border-border bg-white text-text-muted hover:text-text",
                        )}
                      >
                        <input
                          type={question.type === "single" ? "radio" : "checkbox"}
                          name={`study-${question.id}`}
                          checked={active}
                          onChange={() => onToggle(question.id, option.id, question.type)}
                          className="mt-1 h-3.5 w-3.5 shrink-0 accent-[#2d6a4f]"
                        />
                        <span className="leading-6">{option.text}</span>
                      </label>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {step.questions.length === 0 ? (
          <Button type="button" variant="outline" disabled={busy !== null} onClick={onContinue}>
            {busy === `advance:${step.key}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            Continue <ArrowRight className="h-4 w-4" />
          </Button>
        ) : !result ? (
          <Button type="button" disabled={!allAnswered || busy !== null} onClick={onSubmit}>
            {busy === "practice-submit" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            Submit practice
          </Button>
        ) : (
          <Button type="button" variant="outline" disabled={busy !== null} onClick={onContinue}>
            {busy === `advance:${step.key}` ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            See result <ArrowRight className="h-4 w-4" />
          </Button>
        )}
        {!result && !allAnswered && step.questions.length > 0 ? (
          <span className="font-body text-xs text-text-dim">Answer all questions to submit. The attempt saves normally.</span>
        ) : null}
      </div>
    </div>
  );
}

function resultSummary(session: StudySession, ratedCount: number, score: number | null): string {
  const flashcardsStep = session.steps.find((step) => step.kind === "flashcards");
  const practiceStep = session.steps.find((step) => step.kind === "practice");
  const cards = flashcardsStep?.cardRefs.length ?? 0;
  const questions = practiceStep?.questionIds.length ?? 0;
  const parts = [`You rated ${ratedCount} of ${cards} session card${cards === 1 ? "" : "s"}`];
  if (questions > 0) {
    parts.push(score === null ? `and skipped the ${questions}-question practice` : `and scored ${Math.round(score * 100)}% on ${questions} practice question${questions === 1 ? "" : "s"}`);
  }
  return `${parts.join(" ")}. Completing records the session in memory once.`;
}
