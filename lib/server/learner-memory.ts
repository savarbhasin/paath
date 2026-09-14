import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DEMO_LEARNER_CONTAINER_TAG } from "@/lib/sources";
import type { MemoryProvider } from "@/lib/providers/types";

/**
 * Ticket 06 learner memory.
 *
 * Supabase is the source of truth: every quiz answer, quiz completion,
 * flashcard review, misconception, explicit preference, and study completion
 * is written to `learning_events` first. Each row then syncs to Supermemory
 * as a compact sentence with the event id as `customId`
 * (`learning-event-<id>`), which makes retries idempotent — repeating a sync
 * never creates a duplicate provider document.
 *
 * A failed sync never rolls back the local write: the event row is marked
 * `failed` with the provider message, and the next profile, tutor, or study
 * request retries it via `retryPendingMemorySyncs`.
 */

export const LEARNING_EVENT_KINDS = [
  "quiz_answer",
  "quiz_complete",
  "flashcard_review",
  "misconception",
  "preference",
  "study_complete",
] as const;

export type LearningEventKind = (typeof LEARNING_EVENT_KINDS)[number];

export type LearningEventDetails = Record<string, string | number | boolean>;

export type LearningEventRow = {
  id: string;
  courseId: string;
  kind: LearningEventKind;
  payload: LearningEventDetails;
  syncStatus: "pending" | "synced" | "failed";
  syncError: string | null;
  createdAt: string;
};

export type MemorySyncSummary = {
  synced: number;
  pending: number;
  failed: number;
  lastSyncedAt: string | null;
};

const MAX_SYNC_BATCH = 20;

function asDetails(value: unknown): LearningEventDetails {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const details: LearningEventDetails = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      details[key] = entry;
    }
  }
  return details;
}

function parseEventRow(row: Record<string, unknown>): LearningEventRow | null {
  const kind = String(row.kind ?? "");
  if (!(LEARNING_EVENT_KINDS as readonly string[]).includes(kind)) return null;
  const syncStatus = String(row.memory_sync_status ?? "pending");
  return {
    id: String(row.id),
    courseId: String(row.course_id),
    kind: kind as LearningEventKind,
    payload: asDetails(row.payload_json),
    syncStatus: syncStatus === "synced" || syncStatus === "failed" ? syncStatus : "pending",
    syncError: typeof row.memory_error === "string" ? row.memory_error : null,
    createdAt: String(row.created_at ?? new Date(0).toISOString()),
  };
}

/** Compact natural-language sentence sent to Supermemory for one event. */
export function learningEventText(event: Pick<LearningEventRow, "kind" | "payload">): string {
  const details = event.payload;
  const topic = typeof details.topicKey === "string" && details.topicKey ? ` on topic "${details.topicKey}"` : "";
  switch (event.kind) {
    case "quiz_answer": {
      const verdict = details.correct === true ? "answered correctly" : "answered incorrectly";
      const prompt = typeof details.prompt === "string" ? details.prompt.slice(0, 240) : "a quiz question";
      return `The learner ${verdict}${topic}: ${prompt}`;
    }
    case "quiz_complete": {
      const score = typeof details.score === "number" ? `${Math.round(details.score * 100)}%` : "an unknown score";
      const total = typeof details.total === "number" ? ` out of ${details.total} questions` : "";
      return `The learner completed a quiz${topic} with a score of ${score}${total}.`;
    }
    case "flashcard_review": {
      const rating = typeof details.rating === "string" ? details.rating : "reviewed";
      const front = typeof details.front === "string" ? details.front.slice(0, 240) : "a flashcard";
      return `The learner rated a flashcard "${rating}"${topic}: ${front}`;
    }
    case "misconception": {
      const claim = typeof details.claim === "string" ? details.claim.slice(0, 240) : "a misunderstanding";
      const correction = typeof details.correction === "string" ? details.correction.slice(0, 240) : "";
      return `The learner shows a likely misconception${topic}: ${claim}${correction ? ` Correct understanding: ${correction}` : ""}`;
    }
    case "preference": {
      const text = typeof details.text === "string" ? details.text.slice(0, 280) : "a study preference";
      return `The learner stated a study preference: ${text}`;
    }
    case "study_complete": {
      const summary = typeof details.summary === "string" ? details.summary.slice(0, 280) : "a study session";
      return `The learner completed ${summary}.`;
    }
  }
}

/**
 * Writes the app state first. The row starts as `pending`; callers sync it
 * afterwards with `syncLearningEvent`. Sync failures never throw — they mark
 * the row `failed` so the quiz/flashcard write that preceded them stands.
 */
export async function createLearningEvent(
  client: SupabaseClient,
  input: { courseId: string; kind: LearningEventKind; payload: LearningEventDetails },
): Promise<LearningEventRow> {
  const { data, error } = await client
    .from("learning_events")
    .insert({
      course_id: input.courseId,
      kind: input.kind,
      payload_json: input.payload,
      memory_sync_status: "pending",
      memory_error: null,
    })
    .select("id, course_id, kind, payload_json, memory_sync_status, memory_error, created_at")
    .single();
  if (error) throw new Error(`The learning event could not be saved: ${error.message}`);
  const parsed = parseEventRow(data as Record<string, unknown>);
  if (!parsed) throw new Error("The learning event could not be saved.");
  return parsed;
}

/** Syncs one event with its stable customId. Never throws. */
export async function syncLearningEvent(
  client: SupabaseClient,
  memory: MemoryProvider,
  event: LearningEventRow,
): Promise<"synced" | "failed"> {
  try {
    await memory.addLearningEvent({
      id: event.id,
      courseId: event.courseId,
      text: learningEventText(event),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supermemory could not record the learning event.";
    await client
      .from("learning_events")
      .update({ memory_sync_status: "failed", memory_error: message.slice(0, 500) })
      .eq("id", event.id);
    return "failed";
  }
  await client
    .from("learning_events")
    .update({ memory_sync_status: "synced", memory_error: null })
    .eq("id", event.id);
  return "synced";
}

/** Creates the event row, then syncs it. Local state always wins. */
export async function recordAndSyncEvent(
  client: SupabaseClient,
  memory: MemoryProvider,
  input: { courseId: string; kind: LearningEventKind; payload: LearningEventDetails },
): Promise<{ event: LearningEventRow; sync: "synced" | "failed" }> {
  const event = await createLearningEvent(client, input);
  const sync = await syncLearningEvent(client, memory, event);
  return { event: { ...event, syncStatus: sync }, sync };
}

/**
 * Retries every `pending` or `failed` event for the course (oldest first).
 * Each retry reuses the same customId, so no duplicate Supermemory documents
 * are created. Never throws — failures stay marked for the next request.
 */
export async function retryPendingMemorySyncs(
  client: SupabaseClient,
  memory: MemoryProvider,
  courseId: string,
): Promise<{ retried: number; synced: number }> {
  const { data, error } = await client
    .from("learning_events")
    .select("id, course_id, kind, payload_json, memory_sync_status, memory_error, created_at")
    .eq("course_id", courseId)
    .in("memory_sync_status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(MAX_SYNC_BATCH);
  if (error || !data) return { retried: 0, synced: 0 };

  let synced = 0;
  let retried = 0;
  for (const entry of data as Record<string, unknown>[]) {
    const event = parseEventRow(entry);
    if (!event) continue;
    retried += 1;
    if ((await syncLearningEvent(client, memory, event)) === "synced") synced += 1;
  }
  return { retried, synced };
}

export async function memorySyncSummary(client: SupabaseClient, courseId: string): Promise<MemorySyncSummary> {
  const { data, error } = await client
    .from("learning_events")
    .select("memory_sync_status, updated_at")
    .eq("course_id", courseId);
  if (error || !data) return { synced: 0, pending: 0, failed: 0, lastSyncedAt: null };

  let synced = 0;
  let pending = 0;
  let failed = 0;
  let lastSyncedAt: string | null = null;
  for (const entry of data as Record<string, unknown>[]) {
    const status = String(entry.memory_sync_status);
    if (status === "synced") {
      synced += 1;
      const updatedAt = typeof entry.updated_at === "string" ? entry.updated_at : null;
      if (updatedAt && (!lastSyncedAt || updatedAt > lastSyncedAt)) lastSyncedAt = updatedAt;
    } else if (status === "failed") {
      failed += 1;
    } else {
      pending += 1;
    }
  }
  return { synced, pending, failed, lastSyncedAt };
}

export async function listRecentLearningEvents(
  client: SupabaseClient,
  courseId: string,
  limit = 10,
): Promise<LearningEventRow[]> {
  const { data, error } = await client
    .from("learning_events")
    .select("id, course_id, kind, payload_json, memory_sync_status, memory_error, created_at")
    .eq("course_id", courseId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 25));
  if (error || !data) return [];
  const events: LearningEventRow[] = [];
  for (const entry of data as Record<string, unknown>[]) {
    const parsed = parseEventRow(entry);
    if (parsed) events.push(parsed);
  }
  return events;
}

export type LearnerProfileState = {
  profile: { static: string[]; dynamic: string[] };
  profileUsed: boolean;
  /** True when the live fetch failed and the panel shows the last snapshot. */
  stale: boolean;
  fetchedAt: string | null;
};

async function readSnapshot(
  client: SupabaseClient,
): Promise<{ static: string[]; dynamic: string[]; fetchedAt: string | null }> {
  const { data } = await client
    .from("memory_profile_snapshots")
    .select("static_json, dynamic_json, fetched_at")
    .eq("container_tag", DEMO_LEARNER_CONTAINER_TAG)
    .maybeSingle();
  const row = (data ?? null) as Record<string, unknown> | null;
  const asList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
  return {
    static: asList(row?.static_json),
    dynamic: asList(row?.dynamic_json),
    fetchedAt: typeof row?.fetched_at === "string" ? (row.fetched_at as string) : null,
  };
}

async function writeSnapshot(
  client: SupabaseClient,
  profile: { static: string[]; dynamic: string[] },
): Promise<void> {
  await client.from("memory_profile_snapshots").upsert(
    {
      container_tag: DEMO_LEARNER_CONTAINER_TAG,
      static_json: profile.static.slice(0, 25),
      dynamic_json: profile.dynamic.slice(0, 25),
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "container_tag" },
  );
}

/**
 * Loads the live Supermemory profile and persists it as the last confirmed
 * snapshot. When the provider is unreachable, falls back to the snapshot so
 * the panel can show it with a stale state instead of failing.
 */
export async function loadLearnerProfileState(
  client: SupabaseClient,
  memory: MemoryProvider,
): Promise<LearnerProfileState> {
  try {
    const live = await memory.getProfile();
    const profile = {
      static: live.static.slice(0, 25),
      dynamic: live.dynamic.slice(0, 25),
    };
    await writeSnapshot(client, profile);
    return {
      profile,
      profileUsed: profile.static.length + profile.dynamic.length > 0,
      stale: false,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    const snapshot = await readSnapshot(client);
    return {
      profile: { static: snapshot.static, dynamic: snapshot.dynamic },
      profileUsed: snapshot.static.length + snapshot.dynamic.length > 0,
      stale: true,
      fetchedAt: snapshot.fetchedAt,
    };
  }
}
