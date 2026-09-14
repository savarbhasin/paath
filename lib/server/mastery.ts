import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ReviewRating } from "@/lib/study";

/**
 * Ticket 06 deterministic topic mastery and misconceptions.
 *
 * Mastery is deliberately simple (per the data contracts): each graded quiz
 * question contributes one evidence item (correct = 1, incorrect = 0) and
 * each flashcard review contributes one smaller evidence item. The displayed
 * score is a recency-weighted mean bounded to [0, 1]. No probabilistic model.
 *
 * Evidence is recomputed from the stored attempts and reviews, so the
 * `topic_mastery` row is always derivable from app state. Only topics with
 * new evidence are touched — one wrong answer changes only its own record.
 */

export type MasteryLabel = "Strong" | "Good" | "Developing" | "Needs review";

export const NOT_ENOUGH_EVIDENCE = "Not enough evidence";

export type TopicMasteryView = {
  topicKey: string;
  score: number;
  evidenceCount: number;
  /** Stored label; use `displayMasteryLabel` before showing it. */
  label: string;
  lastPracticedAt: string | null;
};

type EvidenceItem = { value: number; kind: "quiz" | "flashcard"; at: string };

/** Quiz evidence carries full weight; flashcard ratings nudge by a capped amount. */
const FLASHCARD_EVIDENCE_WEIGHT = 0.25;
/** Recency decay per evidence age step (0 = oldest). Deterministic. */
const RECENCY_DECAY = 0.9;

const FLASHCARD_VALUE: Record<ReviewRating, number> = {
  again: 0,
  hard: 0.35,
  good: 0.75,
  easy: 1,
};

export function flashcardEvidenceValue(rating: ReviewRating): number {
  return FLASHCARD_VALUE[rating];
}

export function masteryLabelForScore(score: number): MasteryLabel {
  if (score >= 0.8) return "Strong";
  if (score >= 0.6) return "Good";
  if (score >= 0.35) return "Developing";
  return "Needs review";
}

/**
 * Minimum-evidence rule: no mastery label is shown until a topic has at
 * least two evidence items. Ticket 07 should reuse this helper.
 */
export function displayMasteryLabel(view: Pick<TopicMasteryView, "label" | "evidenceCount">): string {
  return view.evidenceCount < 2 ? NOT_ENOUGH_EVIDENCE : view.label;
}

/** Recency-weighted mean of evidence values, oldest first. Bounded [0, 1]. */
export function masteryScoreForEvidence(evidence: EvidenceItem[]): number {
  if (evidence.length === 0) return 0;
  let weightedSum = 0;
  let weightSum = 0;
  const newest = evidence.length - 1;
  for (let index = 0; index < evidence.length; index += 1) {
    const item = evidence[index] as EvidenceItem;
    const typeWeight = item.kind === "quiz" ? 1 : FLASHCARD_EVIDENCE_WEIGHT;
    const weight = typeWeight * Math.pow(RECENCY_DECAY, newest - index);
    weightedSum += weight * Math.min(Math.max(item.value, 0), 1);
    weightSum += weight;
  }
  if (weightSum <= 0) return 0;
  return Math.min(Math.max(weightedSum / weightSum, 0), 1);
}

type CourseEvidence = {
  assessmentArtifactIds: string[];
  cardTopicByCardId: Map<string, string>;
};

async function loadCourseEvidenceMaps(client: SupabaseClient, courseId: string): Promise<CourseEvidence> {
  const { data } = await client
    .from("learning_artifacts")
    .select("id, kind, payload_json")
    .eq("course_id", courseId)
    .in("kind", ["assessment", "flashcards"]);

  const assessmentArtifactIds: string[] = [];
  const cardTopicByCardId = new Map<string, string>();
  for (const entry of ((data ?? []) as Record<string, unknown>[])) {
    const id = String(entry.id);
    if (entry.kind === "assessment") {
      assessmentArtifactIds.push(id);
    } else if (entry.kind === "flashcards") {
      const payload = entry.payload_json as { cards?: Array<{ id?: unknown; topicKey?: unknown }> };
      for (const card of payload?.cards ?? []) {
        if (typeof card?.id === "string" && typeof card?.topicKey === "string") {
          cardTopicByCardId.set(`${id}:${card.id}`, card.topicKey);
        }
      }
    }
  }
  return { assessmentArtifactIds, cardTopicByCardId };
}

async function quizEvidenceByTopic(
  client: SupabaseClient,
  artifactIds: string[],
): Promise<Map<string, EvidenceItem[]>> {
  const byTopic = new Map<string, EvidenceItem[]>();
  if (artifactIds.length === 0) return byTopic;

  const { data, error } = await client
    .from("quiz_attempts")
    .select("results_json, submitted_at")
    .in("artifact_id", artifactIds)
    .order("submitted_at", { ascending: true })
    .limit(500);
  if (error || !data) return byTopic;

  for (const entry of data as Record<string, unknown>[]) {
    const stored = entry.results_json as { results?: Array<{ topicKey?: unknown; correct?: unknown }> } | null;
    const at = typeof entry.submitted_at === "string" ? entry.submitted_at : "";
    for (const result of stored?.results ?? []) {
      if (typeof result?.topicKey !== "string" || !result.topicKey) continue;
      const items = byTopic.get(result.topicKey) ?? [];
      items.push({ value: result.correct === true ? 1 : 0, kind: "quiz", at });
      byTopic.set(result.topicKey, items);
    }
  }
  return byTopic;
}

async function flashcardEvidenceByTopic(
  client: SupabaseClient,
  cardTopicByCardId: Map<string, string>,
  deckArtifactIds: string[],
): Promise<Map<string, EvidenceItem[]>> {
  const byTopic = new Map<string, EvidenceItem[]>();
  if (deckArtifactIds.length === 0) return byTopic;

  const { data, error } = await client
    .from("flashcard_reviews")
    .select("artifact_id, card_id, rating, reviewed_at")
    .in("artifact_id", deckArtifactIds)
    .order("reviewed_at", { ascending: true })
    .limit(500);
  if (error || !data) return byTopic;

  for (const entry of data as Record<string, unknown>[]) {
    const topicKey = cardTopicByCardId.get(`${String(entry.artifact_id)}:${String(entry.card_id)}`);
    const rating = String(entry.rating);
    if (!topicKey || !(rating in FLASHCARD_VALUE)) continue;
    const items = byTopic.get(topicKey) ?? [];
    items.push({
      value: FLASHCARD_VALUE[rating as ReviewRating],
      kind: "flashcard",
      at: typeof entry.reviewed_at === "string" ? entry.reviewed_at : "",
    });
    byTopic.set(topicKey, items);
  }
  return byTopic;
}

async function upsertMasteryRow(
  client: SupabaseClient,
  courseId: string,
  topicKey: string,
  evidence: EvidenceItem[],
): Promise<TopicMasteryView> {
  const score = Math.round(masteryScoreForEvidence(evidence) * 10000) / 10000;
  const label = masteryLabelForScore(score);
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("topic_mastery")
    .upsert(
      {
        course_id: courseId,
        topic_key: topicKey,
        label,
        score,
        evidence_count: evidence.length,
        last_practiced_at: now,
      },
      { onConflict: "course_id,topic_key" },
    )
    .select("topic_key, label, score, evidence_count, last_practiced_at")
    .single();
  if (error) throw new Error(`Topic mastery could not be saved: ${error.message}`);
  const row = data as Record<string, unknown>;
  return {
    topicKey: String(row.topic_key),
    score: Number(row.score),
    evidenceCount: Number(row.evidence_count),
    label: String(row.label),
    lastPracticedAt: typeof row.last_practiced_at === "string" ? (row.last_practiced_at as string) : null,
  };
}

/**
 * Recomputes mastery for exactly the given topics from all stored evidence.
 * The just-written attempt/review rows must already be committed, so the new
 * evidence is included. Throws on write failure so callers can surface it —
 * Supabase write failures must not be reported as complete.
 */
export async function refreshTopicMastery(
  client: SupabaseClient,
  courseId: string,
  topicKeys: string[],
): Promise<TopicMasteryView[]> {
  const topics = [...new Set(topicKeys.filter((key) => key.trim().length > 0))];
  if (topics.length === 0) return [];

  const { assessmentArtifactIds, cardTopicByCardId } = await loadCourseEvidenceMaps(client, courseId);
  const deckArtifactIds = [...new Set([...cardTopicByCardId.keys()].map((key) => key.split(":")[0] as string))];
  const quizByTopic = await quizEvidenceByTopic(client, assessmentArtifactIds);
  const flashcardByTopic = await flashcardEvidenceByTopic(client, cardTopicByCardId, deckArtifactIds);

  const views: TopicMasteryView[] = [];
  for (const topicKey of topics) {
    // Quiz attempts are the primary signal; flashcard reviews only nudge.
    // Evidence merges chronologically across both sources so the
    // recency-weighted mean always favors the latest practice.
    const evidence: EvidenceItem[] = [...(quizByTopic.get(topicKey) ?? []), ...(flashcardByTopic.get(topicKey) ?? [])]
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    if (evidence.length === 0) continue;
    views.push(await upsertMasteryRow(client, courseId, topicKey, evidence));
  }
  return views;
}

export async function listTopicMastery(client: SupabaseClient, courseId: string): Promise<TopicMasteryView[]> {
  const { data, error } = await client
    .from("topic_mastery")
    .select("topic_key, label, score, evidence_count, last_practiced_at")
    .eq("course_id", courseId)
    .order("score", { ascending: true });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((row) => ({
    topicKey: String(row.topic_key),
    score: Number(row.score),
    evidenceCount: Number(row.evidence_count),
    label: String(row.label),
    lastPracticedAt: typeof row.last_practiced_at === "string" ? (row.last_practiced_at as string) : null,
  }));
}

export type MisconceptionView = {
  id: string;
  topicKey: string;
  claim: string;
  correction: string;
  status: string;
  evidenceCount: number;
};

function normalizeClaim(claim: string): string {
  return claim.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 500);
}

/**
 * Records a likely misconception from a wrong answer. Repeats of the same
 * claim (same normalized text, same topic, still active) reinforce the
 * existing row instead of creating a duplicate. Visible locally immediately,
 * even while the remote profile is still updating.
 */
export async function recordMisconception(
  client: SupabaseClient,
  input: { courseId: string; topicKey: string; claim: string; correction: string },
): Promise<{ misconception: MisconceptionView; reinforced: boolean }> {
  const claim = input.claim.trim().slice(0, 500);
  const correction = input.correction.trim().slice(0, 1000) || "Review the cited source passage for this question.";
  if (!claim) throw new Error("A misconception needs the answered claim.");

  const { data: existing } = await client
    .from("misconceptions")
    .select("id, topic_key, claim, correction, status, evidence_count")
    .eq("course_id", input.courseId)
    .eq("topic_key", input.topicKey)
    .eq("status", "active")
    .limit(50);

  const wanted = normalizeClaim(claim);
  const match = ((existing ?? []) as Record<string, unknown>[]).find(
    (row) => normalizeClaim(String(row.claim ?? "")) === wanted,
  );

  if (match) {
    const { data, error } = await client
      .from("misconceptions")
      .update({ evidence_count: Number(match.evidence_count) + 1, correction })
      .eq("id", String(match.id))
      .select("id, topic_key, claim, correction, status, evidence_count")
      .single();
    if (error) throw new Error(`The misconception could not be reinforced: ${error.message}`);
    return { misconception: toMisconceptionView(data as Record<string, unknown>), reinforced: true };
  }

  const { data, error } = await client
    .from("misconceptions")
    .insert({
      course_id: input.courseId,
      topic_key: input.topicKey,
      claim,
      correction,
      status: "active",
      evidence_count: 1,
    })
    .select("id, topic_key, claim, correction, status, evidence_count")
    .single();
  if (error) throw new Error(`The misconception could not be saved: ${error.message}`);
  return { misconception: toMisconceptionView(data as Record<string, unknown>), reinforced: false };
}

function toMisconceptionView(row: Record<string, unknown>): MisconceptionView {
  return {
    id: String(row.id),
    topicKey: String(row.topic_key),
    claim: String(row.claim),
    correction: String(row.correction),
    status: String(row.status),
    evidenceCount: Number(row.evidence_count),
  };
}

export async function listActiveMisconceptions(
  client: SupabaseClient,
  courseId: string,
  limit = 10,
): Promise<MisconceptionView[]> {
  const { data, error } = await client
    .from("misconceptions")
    .select("id, topic_key, claim, correction, status, evidence_count")
    .eq("course_id", courseId)
    .eq("status", "active")
    .order("evidence_count", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 25));
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map(toMisconceptionView);
}

/**
 * One compact learner-state block for tutor and content-generation prompts.
 * Only practiced topics are listed, with the minimum-evidence rule applied.
 */
export function formatLearnerStateForPrompt(input: {
  mastery: TopicMasteryView[];
  misconceptions: MisconceptionView[];
}): string {
  const lines: string[] = [];
  const practiced = input.mastery.slice(0, 10);
  if (practiced.length > 0) {
    lines.push(
      `Topic mastery: ${practiced.map((entry) => `"${entry.topicKey}" is ${displayMasteryLabel(entry)}`).join("; ")}.`,
    );
  } else {
    lines.push("Topic mastery: no practice evidence yet.");
  }
  const open = input.misconceptions.slice(0, 5);
  if (open.length > 0) {
    lines.push("Active misconceptions to address when relevant:");
    for (const item of open) {
      lines.push(`- On "${item.topicKey}" the learner believes: ${item.claim} Correct understanding: ${item.correction}`);
    }
  } else {
    lines.push("Active misconceptions: none recorded.");
  }
  return lines.join("\n");
}
