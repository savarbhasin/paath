import { NextResponse } from "next/server";
import { z } from "zod";

import { DEMO_WORKSPACE_ID } from "@/lib/config";
import { apiError } from "@/lib/server/http";
import { listRecentLearningEvents } from "@/lib/server/learner-memory";
import { displayMasteryLabel, listActiveMisconceptions, listTopicMastery } from "@/lib/server/mastery";
import { courseBelongsToWorkspace, listSourcesByCourse } from "@/lib/server/source-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

type RouteContext = { params: Promise<{ id: string }> };

async function countCourseArtifactRows(
  client: SupabaseClient,
  courseId: string,
  kind: "assessment" | "flashcards",
  table: "quiz_attempts" | "flashcard_reviews",
): Promise<number> {
  const { data: artifacts } = await client
    .from("learning_artifacts")
    .select("id")
    .eq("course_id", courseId)
    .eq("kind", kind);
  const ids = ((artifacts ?? []) as Record<string, unknown>[]).map((row) => String(row.id));
  if (ids.length === 0) return 0;
  const { count } = await client.from(table).select("id", { count: "exact", head: true }).in("artifact_id", ids);
  return count ?? 0;
}

function countCourseAttempts(client: SupabaseClient, courseId: string): Promise<number> {
  return countCourseArtifactRows(client, courseId, "assessment", "quiz_attempts");
}

function countCourseReviews(client: SupabaseClient, courseId: string): Promise<number> {
  return countCourseArtifactRows(client, courseId, "flashcards", "flashcard_reviews");
}

/**
 * Ticket 07 course dashboard. One course-scoped read of notebooks, sources,
 * recent activity, deterministic mastery, and active misconceptions.
 * Mastery comes from `topic_mastery` (never from the prose profile arrays);
 * navigation and recommendations built on this response never mix courses.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError("Course id is invalid.", 400);
  }

  try {
    const client = createSupabaseAdminClient();
    const belongs = await courseBelongsToWorkspace(client, id, DEMO_WORKSPACE_ID);
    if (!belongs) return apiError("The course was not found.", 404);

    const { data: courseRow, error: courseError } = await client
      .from("courses")
      .select("id, title, color")
      .eq("id", id)
      .single();
    if (courseError || !courseRow) return apiError("The course was not found.", 404);
    const course = courseRow as Record<string, unknown>;

    const [
      { data: notebookRows },
      sources,
      masteryRows,
      misconceptions,
      events,
      attemptCount,
      reviewCount,
    ] = await Promise.all([
      client
        .from("notebooks")
        .select("id, title, updated_at")
        .eq("course_id", id)
        .order("created_at", { ascending: true })
        .limit(50),
      listSourcesByCourse(client, id),
      listTopicMastery(client, id),
      listActiveMisconceptions(client, id, 10),
      listRecentLearningEvents(client, id, 8),
      // Attempt and review counts stay course-scoped by joining the course's
      // own artifact ids — never workspace-wide.
      countCourseAttempts(client, id),
      countCourseReviews(client, id),
    ]);

    const notebooks = ((notebookRows ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    }));

    const sourceCounts = { ready: 0, processing: 0, failed: 0, other: 0 };
    for (const source of sources) {
      if (source.status === "ready") sourceCounts.ready += 1;
      else if (source.status === "failed") sourceCounts.failed += 1;
      else if (source.status === "uploading" || source.status === "queued" || source.status === "processing" || source.status === "retrying") {
        sourceCounts.processing += 1;
      } else sourceCounts.other += 1;
    }

    return NextResponse.json({
      course: { id: String(course.id), title: String(course.title), color: String(course.color) },
      notebooks,
      sources: sources.map((source) => ({
        id: source.id,
        title: source.title,
        type: source.type,
        status: source.status,
        updatedAt: source.updatedAt,
      })),
      sourceCounts,
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
      activity: events.map((event) => ({
        id: event.id,
        kind: event.kind,
        topicKey: typeof event.payload.topicKey === "string" ? event.payload.topicKey : null,
        syncStatus: event.syncStatus,
        createdAt: event.createdAt,
      })),
      totals: { attempts: attemptCount, reviews: reviewCount },
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "The dashboard could not be loaded.");
  }
}
