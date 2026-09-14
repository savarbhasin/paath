"use client";

import { useEffect, useId, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  ListChecks,
  LoaderCircle,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useExplanationArtifacts } from "@/components/explanation-artifacts-context";
import type { ArtifactWithStatus } from "@/components/generated-artifacts-store";
import { SourceLinks } from "@/components/visual-block-helpers";
import {
  assessmentPayloadSchema,
  type AssessmentPayload,
  type AssessmentQuestionType,
  type QuizAttemptResult,
} from "@/lib/study";
import { cn } from "@/lib/utils";

type CheckMap = Record<string, QuizAttemptResult>;

type SubmittedView = {
  id: string;
  score: number;
  submittedAt: string;
  results: QuizAttemptResult[];
  /** Ticket 06 learner-state summary returned by the submit route. */
  mastery?: Array<{ topicKey: string; displayLabel: string; score: number; evidenceCount: number }>;
  misconceptions?: Array<{ id: string; topicKey: string; claim: string; evidenceCount: number; reinforced: boolean }>;
  memory?: { synced: number; pending: number; failed: number };
  learningWarning?: string;
};

/**
 * Renders a practice set or quiz inside the notebook. Single-choice uses
 * radios, multi-select uses checkboxes; correctness always comes from the
 * server (exact set match). Practice gives per-question feedback on Check;
 * quiz reveals everything after Submit. Attempts persist and reopen.
 */
export function AssessmentBlockView({ node }: NodeViewProps) {
  const artifactId = typeof node.attrs.artifactId === "string" ? node.attrs.artifactId : null;
  const cachedTitle = typeof node.attrs.title === "string" ? node.attrs.title : "";
  const cachedSubtitle = typeof node.attrs.subtitle === "string" ? node.attrs.subtitle : "";
  const artifacts = useExplanationArtifacts();
  const artifact = artifactId ? artifacts.get(artifactId) : undefined;

  const parsed = artifact ? assessmentPayloadSchema.safeParse(artifact.payload) : null;
  const payload: AssessmentPayload | null = parsed?.success ? parsed.data : null;
  const title = artifact?.title || cachedTitle || "Assessment";
  const subtitle = payload
    ? `${payload.mode === "quiz" ? "Quiz" : "Practice"} · ${payload.questions.length} question${payload.questions.length === 1 ? "" : "s"}`
    : cachedSubtitle;

  // Stable string key: the attempt loader re-runs only when the artifact or
  // its question set actually changes (no fresh object identities in deps).
  const payloadKey = payload ? payload.questions.map((question) => question.id).join(",") : "";

  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [checks, setChecks] = useState<CheckMap>({});
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<{ questionId: string; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedView | null>(null);
  const [attemptsKey, setAttemptsKey] = useState<string | null>(null);
  const groupName = useId();
  // The loader key is a stable string (never a fresh object identity).
  // Loading is derived during render: true until this question set's latest
  // attempt has been read once.
  const loadKey = artifactId && payloadKey ? `${artifactId}:${payloadKey}` : null;
  const attemptsLoading = loadKey !== null && attemptsKey !== loadKey;

  // Reopen the latest persisted attempt after reload. Runs once per artifact
  // + question set; a fresh submit does not re-trigger it. Every setState
  // below runs in the async continuation, never synchronously in the body.
  useEffect(() => {
    if (!loadKey || attemptsKey === loadKey || !artifactId || !payload) return;
    const liveQuestions = payload.questions;
    const currentArtifactId = artifactId;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const load = async () => {
        try {
          const response = await fetch(`/api/assessments/${currentArtifactId}/attempts?limit=1`, { cache: "no-store" });
          const data = (await response.json()) as {
            attempts?: Array<{ id: string; score: number; submittedAt: string; results: unknown }>;
            error?: string;
          };
          if (cancelled) return;
          const latest = response.ok ? data.attempts?.[0] : undefined;
          if (latest) {
            const byId = new Map(liveQuestions.map((question) => [question.id, question]));
            const view = toSubmittedView(latest, byId);
            if (view) setSubmitted(view);
          }
        } catch {
          // Attempts failing to load never blocks answering; the error
          // surfaces only if a submit later fails.
        } finally {
          if (!cancelled) setAttemptsKey(loadKey);
        }
      };
      void load();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // loadKey is the stable stand-in for the artifact + question set (no
    // fresh object identities in the dep array). liveQuestions only feeds the
    // async continuation, keyed by the same loadKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactId, loadKey, attemptsKey]);

  if (!artifact) {
    return (
      <AssessmentFrame title={title} subtitle={subtitle} badge={<Badge>Loading assessment</Badge>} artifact={artifact}>
        <p className="mt-3 flex items-center gap-2 font-body text-sm text-text-muted">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Loading assessment
        </p>
      </AssessmentFrame>
    );
  }

  if (!payload) {
    return (
      <AssessmentFrame
        title={title}
        subtitle={subtitle}
        badge={<Badge className="border-[#f2d1cf] bg-[#fff4f3] text-[#a53f34]">Needs regeneration</Badge>}
        artifact={artifact}
      >
        <div className="mt-3 border border-[#f2d1cf] bg-[#fff4f3] p-3">
          <p className="font-body text-xs leading-5 text-[#93443d]">
            This assessment came back malformed, so nothing usable was kept. Generate it again from the course chat.
          </p>
        </div>
      </AssessmentFrame>
    );
  }

  const isPractice = payload.mode === "practice";
  const answeredCount = payload.questions.filter((question) => (answers[question.id] ?? []).length > 0).length;
  const allAnswered = answeredCount === payload.questions.length;

  const toggleOption = (questionId: string, optionId: string, type: AssessmentQuestionType) => {
    setSubmitError(null);
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

  /** Practice-mode immediate feedback, scored by the server. */
  const checkQuestion = async (questionId: string) => {
    const selected = answers[questionId] ?? [];
    if (selected.length === 0 || checkingId || submitting || submitted) return;
    setCheckingId(questionId);
    setCheckError(null);
    try {
      const response = await fetch(`/api/assessments/${artifactId}/check`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers: { [questionId]: selected } }),
      });
      const data = (await response.json()) as { results?: QuizAttemptResult[]; error?: string };
      if (!response.ok || !Array.isArray(data.results) || data.results.length === 0) {
        throw new Error(data.error ?? "The answer could not be checked.");
      }
      const result = data.results[0] as QuizAttemptResult;
      setChecks((current) => ({ ...current, [questionId]: result }));
    } catch (error) {
      setCheckError({ questionId, message: error instanceof Error ? error.message : "The answer could not be checked." });
    } finally {
      setCheckingId(null);
    }
  };

  /** Scores everything on the server and persists the attempt. */
  const submit = async () => {
    if (submitting || !allAnswered || submitted) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch(`/api/assessments/${artifactId}/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const data = (await response.json()) as { attempt?: SubmittedView; error?: string };
      if (!response.ok || !data.attempt || !Array.isArray(data.attempt.results)) {
        throw new Error(data.error ?? "The submission could not be saved.");
      }
      setSubmitted(data.attempt);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "The submission could not be saved.");
    } finally {
      setSubmitting(false);
    }
  };

  const retake = () => {
    setSubmitted(null);
    setChecks({});
    setAnswers({});
    setCheckError(null);
    setSubmitError(null);
  };

  return (
    <AssessmentFrame
      title={title}
      subtitle={subtitle}
      badge={
        submitted ? (
          <Badge className="border-blue/25 bg-blue-tint text-blue">Submitted</Badge>
        ) : (
          <Badge className="border-blue/25 bg-blue-tint text-blue">Saved to notebook</Badge>
        )
      }
      artifact={artifact}
    >
      {attemptsLoading ? (
        <p className="mt-3 flex items-center gap-2 font-body text-sm text-text-muted">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Loading previous attempt
        </p>
      ) : submitted ? (
        <ResultsView
          submitted={submitted}
          questions={payload.questions}
          onRetake={retake}
        />
      ) : (
        <>
          {!isPractice ? (
            <p className="mt-1 font-body text-xs leading-5 text-text-muted">
              Quiz mode: feedback appears after you submit. Multi-select questions need every correct option and nothing extra.
            </p>
          ) : (
            <p className="mt-1 font-body text-xs leading-5 text-text-muted">
              Practice mode: check each question for immediate feedback, then submit to save the attempt.
            </p>
          )}
          <ol className="mt-3 space-y-3">
            {payload.questions.map((question, index) => {
              const selected = answers[question.id] ?? [];
              const checked = checks[question.id];
              return (
                <li key={question.id} className="border border-border bg-white">
                  <div className="px-4 py-3.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
                        Q{index + 1} · {question.type === "single" ? "Single choice" : "Multi-select"}
                      </span>
                      {checked && isPractice ? (
                        <Badge className={checked.correct ? "border-blue/25 bg-blue-tint text-blue" : "border-[#f2d1cf] bg-[#fff4f3] text-[#a53f34]"}>
                          {checked.correct ? "Correct" : "Not quite"}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1.5 font-body text-[15px] font-medium leading-7 text-text">{question.prompt}</p>
                    <div className="mt-2.5 space-y-1.5" role="group" aria-label={`Question ${index + 1} options`}>
                      {question.options.map((option) => {
                        const active = selected.includes(option.id);
                        const inputId = `${groupName}-${question.id}-${option.id}`;
                        return (
                          <label
                            key={option.id}
                            htmlFor={inputId}
                            className={cn(
                              "pressable flex cursor-pointer items-start gap-2.5 border px-3 py-2.5 font-body text-sm transition-colors",
                              active ? "border-blue bg-blue-tint text-text" : "border-border bg-white text-text-muted hover:text-text",
                            )}
                          >
                            <input
                              id={inputId}
                              type={question.type === "single" ? "radio" : "checkbox"}
                              name={`${groupName}-${question.id}`}
                              checked={active}
                              onChange={() => toggleOption(question.id, option.id, question.type)}
                              className="mt-1 h-3.5 w-3.5 shrink-0 accent-[#2d6a4f]"
                            />
                            <span className="leading-6">{option.text}</span>
                          </label>
                        );
                      })}
                    </div>
                    {isPractice ? (
                      <div className="mt-2.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={selected.length === 0 || checkingId !== null}
                          onClick={() => void checkQuestion(question.id)}
                        >
                          {checkingId === question.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <CircleHelp className="h-3.5 w-3.5" />}
                          {checked ? "Check again" : "Check answer"}
                        </Button>
                        {selected.length === 0 ? (
                          <span className="ml-2 font-body text-xs text-text-dim">Select an option first.</span>
                        ) : null}
                        {checkError?.questionId === question.id ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2 border border-[#f2d1cf] bg-[#fff4f3] px-2.5 py-2">
                            <p className="flex-1 font-body text-xs text-[#93443d]">{checkError.message}</p>
                            <Button type="button" variant="danger" size="sm" onClick={() => void checkQuestion(question.id)}>
                              <RefreshCw className="h-3.5 w-3.5" /> Retry
                            </Button>
                          </div>
                        ) : null}
                        {checked ? <QuestionFeedback result={checked} /> : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!allAnswered || submitting}
              onClick={() => void submit()}
              className="pressable flex h-11 items-stretch overflow-hidden border border-blue bg-blue text-white transition-colors hover:bg-blue-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex flex-1 items-center justify-center px-5 font-body text-[14.5px] font-medium">
                {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : `Submit ${isPractice ? "practice" : "quiz"}`}
              </span>
              <span className="flex w-11 items-center justify-center border-l border-white/20">
                <ListChecks className="h-4 w-4" />
              </span>
            </button>
            <p className="font-body text-xs text-text-muted">
              {answeredCount} of {payload.questions.length} answered
              {!allAnswered ? " — answer all questions to submit." : ""}
            </p>
          </div>
          {submitError ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 border border-[#f2d1cf] bg-[#fff4f3] p-3">
              <AlertCircle className="h-4 w-4 shrink-0 text-[#93443d]" />
              <p className="flex-1 font-body text-xs leading-5 text-[#93443d]">{submitError} Your answers are kept.</p>
              <Button type="button" variant="danger" size="sm" disabled={submitting} onClick={() => void submit()}>
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </Button>
            </div>
          ) : null}
        </>
      )}
    </AssessmentFrame>
  );
}

function AssessmentFrame({
  title,
  subtitle,
  badge,
  artifact,
  children,
}: {
  title: string;
  subtitle: string;
  badge: React.ReactNode;
  artifact: ArtifactWithStatus | undefined;
  children: React.ReactNode;
}) {
  return (
    <NodeViewWrapper className="assessment-block" data-assessment-block="true">
      <div className="border border-border bg-paper" data-drag-handle>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-blue">
            <ListChecks className="h-3.5 w-3.5" /> AI assessment
          </span>
          {badge}
        </div>
        <div className="px-4 py-4">
          <p className="font-heading text-base font-medium tracking-[-0.01em] text-text">{title}</p>
          {subtitle ? <p className="mt-1 font-body text-sm text-text-muted">{subtitle}</p> : null}
          {children}
          {artifact ? <SourceLinks artifact={artifact} /> : null}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

function QuestionFeedback({ result }: { result: QuizAttemptResult }) {
  return (
    <div className={cn("mt-2.5 border px-3 py-2.5", result.correct ? "border-blue/25 bg-blue-tint" : "border-border bg-paper")}>
      <p className="flex items-center gap-1.5 font-body text-xs font-semibold text-text">
        {result.correct ? <CheckCircle2 className="h-3.5 w-3.5 text-blue" /> : <XCircle className="h-3.5 w-3.5 text-[#a53f34]" />}
        {result.correct ? "Correct." : "Not quite — the correct set is highlighted below."}
      </p>
      <p className="mt-1.5 font-body text-xs leading-5 text-text-muted">{result.explanation}</p>
      {result.citations.length > 0 ? <QuestionCitations citations={result.citations} /> : null}
    </div>
  );
}

function QuestionCitations({ citations }: { citations: QuizAttemptResult["citations"] }) {
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const openSource = async (sourceId: string) => {
    setOpeningId(sourceId);
    setOpenError(null);
    try {
      const response = await fetch(`/api/sources/${sourceId}/open`, { cache: "no-store" });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error ?? "The source could not be opened.");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "The source could not be opened.");
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {citations.map((citation) => (
        <Button
          key={citation.sourceId}
          type="button"
          variant="outline"
          size="xs"
          disabled={openingId === citation.sourceId}
          onClick={() => void openSource(citation.sourceId)}
        >
          {openingId === citation.sourceId ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
          {citation.title}
        </Button>
      ))}
      {openError ? <p className="w-full font-body text-xs text-[#a53f34]">{openError}</p> : null}
    </div>
  );
}

function ResultsView({
  submitted,
  questions,
  onRetake,
}: {
  submitted: SubmittedView;
  questions: AssessmentPayload["questions"];
  onRetake: () => void;
}) {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const correctCount = submitted.results.filter((result) => result.correct).length;
  const percent = Math.round(submitted.score * 100);

  return (
    <div className="mt-3">
      <div className="border border-blue/25 bg-blue-tint px-4 py-3">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-blue">Score</p>
        <p className="mt-1 font-heading text-2xl font-medium tracking-[-0.02em] text-text">
          {percent}% · {correctCount} of {questions.length} correct
        </p>
        <p className="mt-1 font-body text-xs text-text-muted">Submitted {formatSubmittedAt(submitted.submittedAt)}</p>
      </div>
      <LearnerStateNote submitted={submitted} />
      <ol className="mt-3 space-y-2.5">
        {submitted.results.map((result, index) => {
          const question = byId.get(result.questionId);
          if (!question) return null;
          const receivedLabels = result.received.map(
            (id) => question.options.find((option) => option.id === id)?.text ?? "Removed option",
          );
          const expectedLabels = result.expected.map(
            (id) => question.options.find((option) => option.id === id)?.text ?? "Removed option",
          );
          return (
            <li key={result.questionId} className="border border-border bg-white px-4 py-3">
              <p className="flex items-center gap-1.5 font-body text-xs font-semibold text-text">
                {result.correct ? <CheckCircle2 className="h-3.5 w-3.5 text-blue" /> : <XCircle className="h-3.5 w-3.5 text-[#a53f34]" />}
                Q{index + 1} · {result.correct ? "Correct" : "Incorrect"}
                <span className="ml-auto font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
                  {result.topicKey}
                </span>
              </p>
              <p className="mt-1.5 font-body text-sm font-medium leading-6 text-text">{question.prompt}</p>
              <p className="mt-1 font-body text-xs leading-5 text-text-muted">
                Your answer: {receivedLabels.length > 0 ? receivedLabels.join("; ") : "No answer"}
              </p>
              {!result.correct ? (
                <p className="mt-0.5 font-body text-xs leading-5 text-text-muted">
                  Correct set: {expectedLabels.join("; ")}
                </p>
              ) : null}
              <p className="mt-1.5 font-body text-xs leading-5 text-text">{result.explanation}</p>
              {result.citations.length > 0 ? <QuestionCitations citations={result.citations} /> : null}
            </li>
          );
        })}
      </ol>
      <div className="mt-3">
        <Button type="button" variant="outline" size="sm" onClick={onRetake}>
          <RefreshCw className="h-3.5 w-3.5" /> Retake
        </Button>
      </div>
    </div>
  );
}

/**
 * Ticket 06: shows what the submit changed in learner memory — per-topic
 * mastery, newly recorded misconceptions, and the memory sync state — so a
 * wrong answer visibly changes only its own topic record.
 */
function LearnerStateNote({ submitted }: { submitted: SubmittedView }) {
  const mastery = submitted.mastery ?? [];
  const misconceptions = submitted.misconceptions ?? [];
  const memory = submitted.memory;
  if (mastery.length === 0 && misconceptions.length === 0 && !memory && !submitted.learningWarning) {
    return null;
  }
  return (
    <div className="mt-2.5 border border-border bg-paper px-3.5 py-3">
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-blue">Memory updated</p>
      {mastery.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {mastery.map((entry) => (
            <Badge key={entry.topicKey} className="border-blue/25 bg-blue-tint text-blue">
              {entry.topicKey}: {entry.displayLabel}
            </Badge>
          ))}
        </div>
      ) : null}
      {misconceptions.length > 0 ? (
        <p className="mt-2 font-body text-xs leading-5 text-text">
          {misconceptions.length} misconception{misconceptions.length === 1 ? "" : "s"} noted
          {misconceptions.some((item) => item.reinforced) ? " (one reinforced)" : ""} — the tutor will address{" "}
          {misconceptions.length === 1 ? "it" : "them"} next time.
        </p>
      ) : null}
      {memory && (memory.pending > 0 || memory.failed > 0) ? (
        <p className="mt-1 font-body text-xs leading-5 text-text-muted">
          Memory sync {memory.failed > 0 ? "failed — quiz state is kept and the retry runs automatically." : "is still updating — local state above is already current."}
        </p>
      ) : null}
      {submitted.learningWarning ? (
        <p className="mt-1 font-body text-xs leading-5 text-text-muted">{submitted.learningWarning}</p>
      ) : null}
    </div>
  );
}

function formatSubmittedAt(iso: string): string {  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Rebuilds the results view from a persisted attempt row, joined against the
 * live questions so removed-option drift cannot break reopen. Returns null
 * when the stored row carries nothing usable.
 */
function toSubmittedView(
  attempt: { id: string; score: number; submittedAt: string; results: unknown },
  questionsById: Map<string, AssessmentPayload["questions"][number]>,
): SubmittedView | null {
  const stored = attempt.results as { results?: Array<{ questionId?: unknown; correct?: unknown; received?: unknown; expected?: unknown }> } | null;
  const rows = Array.isArray(stored?.results) ? stored.results : null;
  if (!rows) return null;
  const results: QuizAttemptResult[] = [];
  for (const [questionId, question] of questionsById) {
    const row = rows.find((entry) => entry.questionId === questionId);
    const received = Array.isArray(row?.received) ? (row.received as unknown[]).filter((id): id is string => typeof id === "string") : [];
    const expected = Array.isArray(row?.expected) ? (row.expected as unknown[]).filter((id): id is string => typeof id === "string") : [...question.correctOptionIds];
    results.push({
      questionId,
      type: question.type,
      correct: row?.correct === true,
      expected,
      received,
      topicKey: question.topicKey,
      prompt: question.prompt,
      explanation: question.explanation,
      citations: question.citations,
    });
  }
  return { id: attempt.id, score: attempt.score, submittedAt: attempt.submittedAt, results };
}
