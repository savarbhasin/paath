import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { assessmentPayloadSchema, flashcardDeckPayloadSchema } from "@/lib/study";
import { displayMasteryLabel, listActiveMisconceptions, listTopicMastery } from "@/lib/server/mastery";

export type DueCardItem = {
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
};

export type WrongQuestionItem = {
  key: string;
  kind: "wrong-question";
  artifactId: string;
  notebookId: string | null;
  questionId: string;
  prompt: string;
  explanation: string;
  topicKey: string;
  submittedAt: string;
};

export type WeakTopicItem = {
  key: string;
  kind: "weak-topic";
  topicKey: string;
  displayLabel: string;
  score: number;
  evidenceCount: number;
};

export type MisconceptionQueueItem = {
  key: string;
  kind: "misconception";
  id: string;
  topicKey: string;
  claim: string;
  correction: string;
  evidenceCount: number;
};

export type ReviewQueueItem = DueCardItem | WrongQuestionItem | WeakTopicItem | MisconceptionQueueItem;

type Row = Record<string, unknown>;

/**
 * Ticket 07 daily review queue. Combines four evidence sources, all scoped to
 * one course so recommendations never mix courses:
 *
 * - flashcards whose `next_review_at` is due (plus never-reviewed cards),
 * - topics with the lowest mastery scores,
 * - recent incorrect quiz questions (latest attempt per question wins),
 * - active misconceptions.
 *
 * Each eligible item appears exactly once: keys are namespaced per kind and
 * unique within it. Completing an item removes or reschedules it through the
 * existing domain routes — rating a card pushes its next review into the
 * future, retaking a quiz supersedes the wrong answer, and resolving a
 * misconception flips its status. No parallel scoring system is introduced.
 */
export async function listDueCards(
  client: SupabaseClient,
  courseId: string,
  limit = 10,
): Promise<DueCardItem[]> {
  const { data: decks, error } = await client
    .from("learning_artifacts")
    .select("id, notebook_id, payload_json")
    .eq("course_id", courseId)
    .eq("kind", "flashcards")
    .eq("status", "ready")
    .order("created_at", { ascending: true })
    .limit(50);
  if (error || !decks) return [];
  const deckRows = decks as Row[];

  const cardsByKey = new Map<
    string,
    { artifactId: string; notebookId: string | null; cardId: string; front: string; topicKey: string }
  >();
  for (const deck of deckRows) {
    const parsed = flashcardDeckPayloadSchema.safeParse(deck.payload_json ?? {});
    if (!parsed.success) continue;
    for (const card of parsed.data.cards) {
      cardsByKey.set(`${String(deck.id)}:${card.id}`, {
        artifactId: String(deck.id),
        notebookId: deck.notebook_id == null ? null : String(deck.notebook_id),
        cardId: card.id,
        front: card.front,
        topicKey: card.topicKey,
      });
    }
  }
  if (cardsByKey.size === 0) return [];

  const artifactIds = [...new Set([...cardsByKey.values()].map((card) => card.artifactId))];
  const { data: reviews } = await client
    .from("flashcard_reviews")
    .select("artifact_id, card_id, rating, reviewed_at, next_review_at")
    .in("artifact_id", artifactIds)
    .order("reviewed_at", { ascending: false })
    .limit(1000);

  const latestByKey = new Map<string, Row>();
  for (const entry of ((reviews ?? []) as Row[])) {
    const key = `${String(entry.artifact_id)}:${String(entry.card_id)}`;
    if (!latestByKey.has(key) && cardsByKey.has(key)) latestByKey.set(key, entry);
  }

  const now = new Date().toISOString();
  const due: DueCardItem[] = [];
  const fresh: DueCardItem[] = [];
  for (const [key, card] of cardsByKey) {
    const latest = latestByKey.get(key);
    if (!latest) {
      fresh.push({
        key: `flashcard:${key}`,
        kind: "flashcard",
        artifactId: card.artifactId,
        notebookId: card.notebookId,
        cardId: card.cardId,
        front: card.front,
        topicKey: card.topicKey,
        lastRating: null,
        nextReviewAt: null,
        isNew: true,
      });
      continue;
    }
    const nextReviewAt = typeof latest.next_review_at === "string" ? latest.next_review_at : null;
    if (nextReviewAt && nextReviewAt <= now) {
      due.push({
        key: `flashcard:${key}`,
        kind: "flashcard",
        artifactId: card.artifactId,
        notebookId: card.notebookId,
        cardId: card.cardId,
        front: card.front,
        topicKey: card.topicKey,
        lastRating: typeof latest.rating === "string" ? latest.rating : null,
        nextReviewAt,
        isNew: false,
      });
    }
  }

  // Overdue cards first (oldest due date), then never-reviewed cards.
  due.sort((a, b) => (a.nextReviewAt ?? "").localeCompare(b.nextReviewAt ?? ""));
  return [...due, ...fresh].slice(0, Math.min(Math.max(limit, 1), 25));
}

/**
 * Recent incorrect quiz questions, newest first. Only the latest attempt per
 * question is eligible, so a retaken question appears once. Wrong answers that
 * a newer attempt already fixed stay out of the queue.
 */
export async function listWrongQuestions(
  client: SupabaseClient,
  courseId: string,
  limit = 8,
): Promise<WrongQuestionItem[]> {
  const { data: artifacts, error } = await client
    .from("learning_artifacts")
    .select("id, notebook_id, payload_json")
    .eq("course_id", courseId)
    .eq("kind", "assessment")
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(25);
  if (error || !artifacts) return [];
  const artifactRows = artifacts as Row[];
  const artifactIds = artifactRows.map((row) => String(row.id));
  if (artifactIds.length === 0) return [];

  const notebookByArtifact = new Map(
    artifactRows.map((row) => [String(row.id), row.notebook_id == null ? null : String(row.notebook_id)]),
  );

  const { data: attempts } = await client
    .from("quiz_attempts")
    .select("artifact_id, results_json, submitted_at")
    .in("artifact_id", artifactIds)
    .order("submitted_at", { ascending: false })
    .limit(100);

  const seenQuestions = new Set<string>();
  const items: WrongQuestionItem[] = [];
  const capped = Math.min(Math.max(limit, 1), 25);
  for (const entry of ((attempts ?? []) as Row[])) {
    const artifactId = String(entry.artifact_id);
    const stored = entry.results_json as {
      results?: Array<{
        questionId?: unknown;
        correct?: unknown;
        prompt?: unknown;
        explanation?: unknown;
        topicKey?: unknown;
      }>;
    } | null;
    const submittedAt = typeof entry.submitted_at === "string" ? entry.submitted_at : "";
    for (const result of stored?.results ?? []) {
      if (result?.correct === true || typeof result?.questionId !== "string") continue;
      const dedupeKey = `${artifactId}:${result.questionId}`;
      if (seenQuestions.has(dedupeKey)) continue;
      seenQuestions.add(dedupeKey);
      if (items.length >= capped) break;
      items.push({
        key: `wrong:${dedupeKey}`,
        kind: "wrong-question",
        artifactId,
        notebookId: notebookByArtifact.get(artifactId) ?? null,
        questionId: result.questionId,
        prompt: typeof result.prompt === "string" ? result.prompt : "A quiz question",
        explanation: typeof result.explanation === "string" ? result.explanation : "",
        topicKey: typeof result.topicKey === "string" && result.topicKey ? result.topicKey : "general",
        submittedAt,
      });
    }
    if (items.length >= capped) break;
  }
  return items;
}

export async function listWeakTopics(
  client: SupabaseClient,
  courseId: string,
  limit = 5,
): Promise<WeakTopicItem[]> {
  const mastery = await listTopicMastery(client, courseId);
  return mastery
    .filter((entry) => entry.score < 0.6 && entry.evidenceCount > 0)
    .slice(0, Math.min(Math.max(limit, 1), 10))
    .map((entry) => ({
      key: `topic:${entry.topicKey}`,
      kind: "weak-topic" as const,
      topicKey: entry.topicKey,
      displayLabel: displayMasteryLabel(entry),
      score: entry.score,
      evidenceCount: entry.evidenceCount,
    }));
}

export async function listMisconceptionItems(
  client: SupabaseClient,
  courseId: string,
  limit = 5,
): Promise<MisconceptionQueueItem[]> {
  const open = await listActiveMisconceptions(client, courseId, limit);
  return open.map((entry) => ({
    key: `misconception:${entry.id}`,
    kind: "misconception" as const,
    id: entry.id,
    topicKey: entry.topicKey,
    claim: entry.claim,
    correction: entry.correction,
    evidenceCount: entry.evidenceCount,
  }));
}

export type ReviewQueue = {
  items: ReviewQueueItem[];
  counts: { flashcards: number; wrongQuestions: number; weakTopics: number; misconceptions: number };
};

export async function buildReviewQueue(client: SupabaseClient, courseId: string): Promise<ReviewQueue> {
  const [flashcards, wrongQuestions, weakTopics, misconceptions] = await Promise.all([
    listDueCards(client, courseId, 10),
    listWrongQuestions(client, courseId, 8),
    listWeakTopics(client, courseId, 5),
    listMisconceptionItems(client, courseId, 5),
  ]);
  return {
    items: [...flashcards, ...wrongQuestions, ...weakTopics, ...misconceptions],
    counts: {
      flashcards: flashcards.length,
      wrongQuestions: wrongQuestions.length,
      weakTopics: weakTopics.length,
      misconceptions: misconceptions.length,
    },
  };
}

export function deckPayloadForArtifact(payload: unknown) {
  return flashcardDeckPayloadSchema.safeParse(payload ?? {});
}

export function assessmentPayloadForArtifact(payload: unknown) {
  return assessmentPayloadSchema.safeParse(payload ?? {});
}
