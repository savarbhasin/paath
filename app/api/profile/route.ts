import { NextResponse } from "next/server";
import { z } from "zod";

import { DEMO_WORKSPACE_ID } from "@/lib/config";
import { createSupermemoryMemoryProvider } from "@/lib/providers/memory";
import { apiError } from "@/lib/server/http";
import {
  listRecentLearningEvents,
  loadLearnerProfileState,
  memorySyncSummary,
  retryPendingMemorySyncs,
} from "@/lib/server/learner-memory";
import {
  displayMasteryLabel,
  listActiveMisconceptions,
  listTopicMastery,
} from "@/lib/server/mastery";
import { courseBelongsToWorkspace } from "@/lib/server/source-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Ticket 06 learner-memory panel state.
 *
 * Retries pending/failed memory syncs first (idempotent by customId), then
 * returns the last confirmed remote profile alongside the local evidence:
 * recent learning events (with their sync status), deterministic topic
 * mastery with the minimum-evidence rule applied, and active misconceptions.
 * The panel can therefore distinguish a local learning event from the last
 * confirmed remote profile, and show updating / stale / failed-sync states.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const courseId = searchParams.get("courseId") ?? "";
  if (!z.string().uuid().safeParse(courseId).success) {
    return apiError("A valid course id is required.", 400);
  }

  try {
    const client = createSupabaseAdminClient();
    const belongs = await courseBelongsToWorkspace(client, courseId, DEMO_WORKSPACE_ID);
    if (!belongs) return apiError("The course was not found.", 404);

    const memory = createSupermemoryMemoryProvider();
    try {
      await retryPendingMemorySyncs(client, memory, courseId);
    } catch {
      // Sync failures never block the panel; rows stay marked for next time.
    }

    const [profileState, sync, events, masteryRows, misconceptions] = await Promise.all([
      loadLearnerProfileState(client, memory),
      memorySyncSummary(client, courseId),
      listRecentLearningEvents(client, courseId, 10),
      listTopicMastery(client, courseId),
      listActiveMisconceptions(client, courseId, 10),
    ]);

    return NextResponse.json({
      profile: profileState.profile,
      profileUsed: profileState.profileUsed,
      stale: profileState.stale,
      fetchedAt: profileState.fetchedAt,
      updating: sync.pending > 0,
      sync,
      events: events.map((event) => ({
        id: event.id,
        kind: event.kind,
        topicKey: typeof event.payload.topicKey === "string" ? event.payload.topicKey : null,
        syncStatus: event.syncStatus,
        syncError: event.syncError,
        createdAt: event.createdAt,
      })),
      mastery: masteryRows.map((entry) => ({
        topicKey: entry.topicKey,
        label: entry.label,
        displayLabel: displayMasteryLabel(entry),
        score: entry.score,
        evidenceCount: entry.evidenceCount,
        lastPracticedAt: entry.lastPracticedAt,
      })),
      misconceptions: misconceptions.map((entry) => ({
        id: entry.id,
        topicKey: entry.topicKey,
        claim: entry.claim,
        correction: entry.correction,
        evidenceCount: entry.evidenceCount,
      })),
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "The learner profile could not be loaded.");
  }
}
