import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { MemoryProvider } from "@/lib/providers/types";
import { recordAndSyncEvent } from "@/lib/server/learner-memory";
import { listActiveMisconceptions, listTopicMastery } from "@/lib/server/mastery";
import { assessmentPayloadForArtifact, deckPayloadForArtifact, listDueCards } from "@/lib/server/review-study";
import type { AssessmentPayload } from "@/lib/study";

export const studyStepKindSchema = z.enum(["recap", "flashcards", "practice", "result"]);
export type StudyStepKind = z.infer<typeof studyStepKindSchema>;

export const studyStepStatusSchema = z.enum(["pending", "active", "complete", "skipped"]);
export type StudyStepStatus = z.infer<typeof studyStepStatusSchema>;

export const studyStepSchema = z.object({
  key: z.string().min(1).max(60),
  kind: studyStepKindSchema,
  status: studyStepStatusSchema,
  artifactId: z.string().uuid().nullable(),
  /** Flashcard refs as "<artifactId>:<cardId>" so one step can span decks. */
  cardRefs: z.array(z.string().min(1).max(300)).default([]),
  questionIds: z.array(z.string().min(1).max(120)).default([]),
  title: z.string().max(160).default(""),
  /** Deterministic recap / result text stored with the session. */
  detail: z.string().max(4000).default(""),
});

export type StudyStep = z.infer<typeof studyStepSchema>;

export type StudySessionView = {
  id: string;
  courseId: string;
  status: "active" | "completed" | "abandoned";
  steps: StudyStep[];
  startedAt: string;
  completedAt: string | null;
};

export type StudyCardContent = {
  artifactId: string;
  cardId: string;
  front: string;
  back: string;
  topicKey: string;
};

export type EnrichedStudyStep = StudyStep & {
  cards: StudyCardContent[];
  questions: AssessmentPayload["questions"];
};

export type EnrichedStudySession = Omit<StudySessionView, "steps"> & { steps: EnrichedStudyStep[] };

type Row = Record<string, unknown>;

function parseSteps(value: unknown): StudyStep[] | null {
  const parsed = z.array(studyStepSchema).min(1).max(4).safeParse(value ?? []);
  return parsed.success ? parsed.data : null;
}

function toSessionView(row: Row): StudySessionView | null {
  const steps = parseSteps(row.steps_json);
  if (!steps) return null;
  const status = String(row.status);
  if (status !== "active" && status !== "completed" && status !== "abandoned") return null;
  return {
    id: String(row.id),
    courseId: String(row.course_id),
    status,
    steps,
    startedAt: typeof row.started_at === "string" ? row.started_at : new Date(0).toISOString(),
    completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
  };
}

const SESSION_COLUMNS = "id, course_id, status, steps_json, started_at, completed_at";

function buildRecapDetail(input: {
  weakTopics: Array<{ topicKey: string; displayLabel: string; score: number }>;
  misconceptions: Array<{ topicKey: string; claim: string; correction: string }>;
  dueCount: number;
  questionCount: number;
}): string {
  const lines: string[] = [];
  if (input.weakTopics.length > 0) {
    lines.push(
      `Focus topics: ${input.weakTopics
        .map((topic) => `"${topic.topicKey}" (${topic.displayLabel}, ${Math.round(topic.score * 100)}%)`)
        .join("; ")}.`,
    );
  } else {
    lines.push("No weak topics yet — this session warms up with due cards and practice.");
  }
  if (input.misconceptions.length > 0) {
    lines.push("Watch out for these past mistakes:");
    for (const item of input.misconceptions.slice(0, 3)) {
      lines.push(`- On "${item.topicKey}": ${item.claim} Correct: ${item.correction}`);
    }
  }
  lines.push(
    `This session covers ${input.dueCount} flashcard${input.dueCount === 1 ? "" : "s"}${
      input.questionCount > 0 ? ` and ${input.questionCount} practice question${input.questionCount === 1 ? "" : "s"}` : ""
    }.`,
  );
  return lines.join("\n").slice(0, 4000);
}

/**
 * Creates the one fixed Study Mode sequence: recap → flashcards → practice →
 * result. Reuses existing evidence only — due cards from ready decks and the
 * latest ready assessment — and writes nothing except the session row, so no
 * provider calls run and no parallel scoring system is introduced. Scoring
 * happens later through the normal flashcard review and assessment submit
 * routes while the user works the steps.
 *
 * An already-active session for the course is returned as-is (resumed), which
 * keeps duplicate POSTs from forking parallel sessions.
 */
export async function createStudySession(
  client: SupabaseClient,
  courseId: string,
): Promise<{ session: StudySessionView; created: boolean }> {
  const existing = await getActiveStudySession(client, courseId);
  if (existing) return { session: existing, created: false };

  const [dueCards, weakTopics, misconceptions, { data: assessments }] = await Promise.all([
    listDueCards(client, courseId, 6),
    listTopicMastery(client, courseId).then((rows) =>
      rows.filter((entry) => entry.score < 0.6 && entry.evidenceCount > 0).slice(0, 5),
    ),
    listActiveMisconceptions(client, courseId, 5),
    client
      .from("learning_artifacts")
      .select("id, payload_json")
      .eq("course_id", courseId)
      .eq("kind", "assessment")
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  let practiceArtifactId: string | null = null;
  let practiceQuestionIds: string[] = [];
  const latest = ((assessments ?? []) as Row[])[0];
  if (latest) {
    const parsed = assessmentPayloadForArtifact(latest.payload_json);
    if (parsed.success) {
      practiceArtifactId = String(latest.id);
      practiceQuestionIds = parsed.data.questions.map((question) => question.id);
    }
  }

  const steps: StudyStep[] = [
    {
      key: "recap",
      kind: "recap",
      status: "active",
      artifactId: null,
      cardRefs: [],
      questionIds: [],
      title: "Recap",
      detail: buildRecapDetail({
        weakTopics: weakTopics.map((entry) => ({
          topicKey: entry.topicKey,
          displayLabel: entry.label,
          score: entry.score,
        })),
        misconceptions,
        dueCount: dueCards.length,
        questionCount: practiceQuestionIds.length,
      }),
    },
    {
      key: "flashcards",
      kind: "flashcards",
      status: dueCards.length > 0 ? "pending" : "skipped",
      artifactId: dueCards[0]?.artifactId ?? null,
      cardRefs: dueCards.map((card) => `${card.artifactId}:${card.cardId}`),
      questionIds: [],
      title: "Flashcards",
      detail: dueCards.length > 0 ? "" : "No cards are due right now.",
    },
    {
      key: "practice",
      kind: "practice",
      status: practiceArtifactId ? "pending" : "skipped",
      artifactId: practiceArtifactId,
      cardRefs: [],
      questionIds: practiceQuestionIds,
      title: "Practice",
      detail: practiceArtifactId ? "" : "No practice set exists yet — generate one from a notebook selection.",
    },
    {
      key: "result",
      kind: "result",
      status: "pending",
      artifactId: null,
      cardRefs: [],
      questionIds: [],
      title: "Result",
      detail: "",
    },
  ];

  const { data, error } = await client
    .from("study_sessions")
    .insert({ course_id: courseId, status: "active", steps_json: steps })
    .select(SESSION_COLUMNS)
    .single();
  if (error) throw new Error(`The study session could not be started: ${error.message}`);
  const session = toSessionView(data as Row);
  if (!session) throw new Error("The study session could not be started.");
  return { session, created: true };
}

export async function getActiveStudySession(
  client: SupabaseClient,
  courseId: string,
): Promise<StudySessionView | null> {
  const { data } = await client
    .from("study_sessions")
    .select(SESSION_COLUMNS)
    .eq("course_id", courseId)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return toSessionView(data as Row);
}

export async function getStudySession(client: SupabaseClient, sessionId: string): Promise<StudySessionView | null> {
  const { data } = await client.from("study_sessions").select(SESSION_COLUMNS).eq("id", sessionId).maybeSingle();
  if (!data) return null;
  return toSessionView(data as Row);
}

/**
 * Resolves stored step refs into renderable content. Flashcards resolve
 * against live deck payloads (a removed card drops out instead of breaking
 * the session); practice resolves against the live assessment payload.
 */
export async function enrichStudySession(
  client: SupabaseClient,
  session: StudySessionView,
): Promise<EnrichedStudySession> {
  const deckCache = new Map<string, Map<string, { front: string; back: string; topicKey: string }>>();
  const assessmentCache = new Map<string, AssessmentPayload["questions"]>();

  async function deckCards(artifactId: string) {
    const cached = deckCache.get(artifactId);
    if (cached) return cached;
    const { data } = await client
      .from("learning_artifacts")
      .select("payload_json")
      .eq("id", artifactId)
      .maybeSingle();
    const parsed = deckPayloadForArtifact((data as Row | null)?.payload_json);
    const byId = new Map<string, { front: string; back: string; topicKey: string }>();
    if (parsed.success) {
      for (const card of parsed.data.cards) {
        byId.set(card.id, { front: card.front, back: card.back, topicKey: card.topicKey });
      }
    }
    deckCache.set(artifactId, byId);
    return byId;
  }

  async function assessmentQuestions(artifactId: string) {
    const cached = assessmentCache.get(artifactId);
    if (cached) return cached;
    const { data } = await client
      .from("learning_artifacts")
      .select("payload_json")
      .eq("id", artifactId)
      .maybeSingle();
    const parsed = assessmentPayloadForArtifact((data as Row | null)?.payload_json);
    const questions = parsed.success ? parsed.data.questions : [];
    assessmentCache.set(artifactId, questions);
    return questions;
  }

  const steps: EnrichedStudyStep[] = [];
  for (const step of session.steps) {
    if (step.kind === "flashcards") {
      const cards: StudyCardContent[] = [];
      for (const ref of step.cardRefs) {
        const separator = ref.indexOf(":");
        if (separator <= 0) continue;
        const artifactId = ref.slice(0, separator);
        const cardId = ref.slice(separator + 1);
        const card = (await deckCards(artifactId)).get(cardId);
        if (card) cards.push({ artifactId, cardId, ...card });
      }
      steps.push({ ...step, cards, questions: [] });
    } else if (step.kind === "practice" && step.artifactId) {
      const questions = (await assessmentQuestions(step.artifactId)).filter((question) =>
        step.questionIds.length === 0 ? true : step.questionIds.includes(question.id),
      );
      steps.push({ ...step, cards: [], questions });
    } else {
      steps.push({ ...step, cards: [], questions: [] });
    }
  }
  return { ...session, steps };
}

async function persistSteps(client: SupabaseClient, sessionId: string, steps: StudyStep[]): Promise<StudySessionView> {
  const { data, error } = await client
    .from("study_sessions")
    .update({ steps_json: steps })
    .eq("id", sessionId)
    .eq("status", "active")
    .select(SESSION_COLUMNS)
    .single();
  if (error) throw new Error(`The study session could not be updated: ${error.message}`);
  const session = toSessionView(data as Row);
  if (!session) throw new Error("The study session could not be updated.");
  return session;
}

/**
 * Marks one step complete or skipped and activates the next pending step.
 * The result step cannot advance here — it completes through `completeStudySession`.
 */
export async function advanceStudyStep(
  client: SupabaseClient,
  sessionId: string,
  stepKey: string,
  status: "complete" | "skipped",
): Promise<StudySessionView> {
  const session = await getStudySession(client, sessionId);
  if (!session) throw new Error("The study session was not found.");
  if (session.status !== "active") throw new Error("This study session is already finished.");
  const index = session.steps.findIndex((step) => step.key === stepKey);
  if (index < 0) throw new Error("This study step does not exist.");
  const step = session.steps[index] as StudyStep;
  if (step.kind === "result") throw new Error("Finish the session to complete the result step.");

  const steps = session.steps.map((entry, entryIndex) =>
    entryIndex === index ? { ...entry, status } : entry,
  );
  const nextPending = steps.find((entry) => entry.status === "pending");
  const nextSteps = steps.map((entry) =>
    nextPending && entry.key === nextPending.key ? { ...entry, status: "active" as const } : entry,
  );
  return persistSteps(client, sessionId, nextSteps);
}

/**
 * Completes the session and writes exactly one `study_complete` learning
 * event through the normal memory path. Duplicate protection: the status flip
 * is guarded on `active`, so a second completion returns the finished session
 * without writing another event. Quiz, review, and mastery records were
 * already written by the normal routes while the user worked the steps.
 */
export async function completeStudySession(
  client: SupabaseClient,
  memory: MemoryProvider,
  sessionId: string,
): Promise<{ session: StudySessionView; alreadyCompleted: boolean; memoryWarning: string | null }> {
  const session = await getStudySession(client, sessionId);
  if (!session) throw new Error("The study session was not found.");
  if (session.status === "completed") return { session, alreadyCompleted: true, memoryWarning: null };
  if (session.status !== "active") throw new Error("This study session is already finished.");

  const finishedSteps = session.steps.map((step) =>
    step.kind === "result"
      ? { ...step, status: "complete" as const }
      : step.status === "pending" || step.status === "active"
        ? { ...step, status: "skipped" as const }
        : step,
  );
  const flashcardsStep = finishedSteps.find((step) => step.kind === "flashcards");
  const practiceStep = finishedSteps.find((step) => step.kind === "practice");
  const now = new Date().toISOString();

  const { data, error } = await client
    .from("study_sessions")
    .update({ status: "completed", steps_json: finishedSteps, completed_at: now })
    .eq("id", sessionId)
    .eq("status", "active")
    .select(SESSION_COLUMNS)
    .maybeSingle();
  if (error) throw new Error(`The study session could not be completed: ${error.message}`);
  if (!data) {
    const reread = await getStudySession(client, sessionId);
    if (reread && reread.status === "completed") return { session: reread, alreadyCompleted: true, memoryWarning: null };
    throw new Error("The study session could not be completed.");
  }
  const completed = toSessionView(data as Row);
  if (!completed) throw new Error("The study session could not be completed.");

  let memoryWarning: string | null = null;
  try {
    const cardCount = flashcardsStep?.cardRefs.length ?? 0;
    const questionCount = practiceStep?.questionIds.length ?? 0;
    await recordAndSyncEvent(client, memory, {
      courseId: completed.courseId,
      kind: "study_complete",
      payload: {
        sessionId: completed.id,
        flashcards: cardCount,
        questions: questionCount,
        summary: `a study session with ${cardCount} flashcard${cardCount === 1 ? "" : "s"} and ${questionCount} practice question${questionCount === 1 ? "" : "s"}`,
      },
    });
  } catch (requestError) {
    // The session completion stands (product state first); the event row is
    // the audit trail and its failure surfaces as a warning only.
    memoryWarning = requestError instanceof Error ? requestError.message : "Learner memory could not be updated.";
  }
  return { session: completed, alreadyCompleted: false, memoryWarning };
}
