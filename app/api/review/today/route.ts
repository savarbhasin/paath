import { NextResponse } from "next/server";
import { z } from "zod";

import { DEMO_WORKSPACE_ID } from "@/lib/config";
import { createSupermemoryMemoryProvider } from "@/lib/providers/memory";
import { apiError } from "@/lib/server/http";
import { retryPendingMemorySyncs } from "@/lib/server/learner-memory";
import { buildReviewQueue } from "@/lib/server/review-study";
import { courseBelongsToWorkspace } from "@/lib/server/source-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Ticket 07 daily review queue. Combines due flashcards, low-mastery topics,
 * recent wrong questions, and active misconceptions for one course only.
 * Each eligible item appears once; rating or completing an item removes or
 * reschedules it through the existing flashcard, assessment, and
 * misconception routes.
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

    // A review pass is a study request: flush pending memory syncs first so
    // the queue (and the mastery behind it) reflects confirmed state.
    try {
      await retryPendingMemorySyncs(client, createSupermemoryMemoryProvider(), courseId);
    } catch {
      // Sync failures never block the queue; rows stay marked for next time.
    }

    const queue = await buildReviewQueue(client, courseId);
    return NextResponse.json({ courseId, ...queue });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "The review queue could not be loaded.");
  }
}
