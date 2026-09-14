import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupermemoryMemoryProvider } from "@/lib/providers/memory";
import { apiError, readJson } from "@/lib/server/http";
import { memorySyncSummary, recordAndSyncEvent } from "@/lib/server/learner-memory";
import { displayMasteryLabel, refreshTopicMastery } from "@/lib/server/mastery";
import { flashcardDeckPayloadSchema, nextReviewAt, reviewRatingSchema } from "@/lib/study";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ artifactId: string }> };

const reviewInput = z.object({
  cardId: z.string().min(1).max(120),
  rating: reviewRatingSchema,
});

/**
 * Persists a flashcard review and its deterministic next-review date.
 * The row is the evidence ticket 06 consumes for mastery, so it stays
 * queryable per card (and per topic key via the deck payload).
 *
 * Ticket 06 then refreshes the card's topic mastery and records a
 * flashcard_review learning event, synced to Supermemory. A failed sync
 * never rolls back the review.
 */
export async function POST(request: Request, context: RouteContext) {
  const { artifactId } = await context.params;
  if (!z.string().uuid().safeParse(artifactId).success) {
    return apiError("Artifact id is invalid.", 400);
  }

  let input: z.infer<typeof reviewInput>;
  try {
    input = reviewInput.parse(await readJson(request));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError("A valid card and rating (again, hard, good, easy) are required.", 400);
    }
    return apiError("Request body must be valid JSON.", 400);
  }

  try {
    const client = createSupabaseAdminClient();
    const { data: artifact, error: artifactError } = await client
      .from("learning_artifacts")
      .select("id, course_id, kind, status, payload_json")
      .eq("id", artifactId)
      .single();
    if (artifactError || !artifact) return apiError("The deck was not found.", 404);
    const row = artifact as Record<string, unknown>;
    if (row.kind !== "flashcards") return apiError("This block is not a flashcard deck.", 400);
    if (row.status !== "ready") return apiError("This deck is not ready yet.", 409);

    const parsed = flashcardDeckPayloadSchema.safeParse(row.payload_json ?? {});
    if (!parsed.success) return apiError("This deck is malformed. Generate it again.", 422);
    const card = parsed.data.cards.find((entry) => entry.id === input.cardId);
    if (!card) return apiError("This card does not belong to the deck.", 400);

    const reviewedAt = new Date();
    const nextReview = nextReviewAt(input.rating, reviewedAt);
    const { data: review, error: reviewError } = await client
      .from("flashcard_reviews")
      .insert({
        artifact_id: artifactId,
        card_id: input.cardId,
        rating: input.rating,
        reviewed_at: reviewedAt.toISOString(),
        next_review_at: nextReview.toISOString(),
      })
      .select("id, card_id, rating, reviewed_at, next_review_at")
      .single();
    if (reviewError) {
      return apiError(`The review could not be saved: ${reviewError.message}`);
    }

    const saved = review as Record<string, unknown>;
    const courseId = String(row.course_id);

    // Ticket 06: the review above is committed first. Mastery and the memory
    // event derive from it; sync failures never roll the review back.
    let mastery: { topicKey: string; displayLabel: string; score: number; evidenceCount: number } | null = null;
    let memorySync: "synced" | "failed" = "synced";
    let learningWarning: string | null = null;
    try {
      const memoryProvider = createSupermemoryMemoryProvider();
      const sync = await recordAndSyncEvent(client, memoryProvider, {
        courseId,
        kind: "flashcard_review",
        payload: {
          artifactId,
          cardId: input.cardId,
          topicKey: card.topicKey,
          rating: input.rating,
          front: card.front.slice(0, 240),
        },
      });
      memorySync = sync.sync;
      const refreshed = await refreshTopicMastery(client, courseId, [card.topicKey]);
      const entry = refreshed[0];
      if (entry) {
        mastery = {
          topicKey: entry.topicKey,
          displayLabel: displayMasteryLabel(entry),
          score: entry.score,
          evidenceCount: entry.evidenceCount,
        };
      }
    } catch (error) {
      learningWarning = error instanceof Error ? error.message : "Learner memory could not be updated.";
    }
    const memory = await memorySyncSummary(client, courseId).catch(() => ({
      synced: 0,
      pending: 0,
      failed: 0,
      lastSyncedAt: null as string | null,
    }));

    return NextResponse.json(
      {
        review: {
          cardId: String(saved.card_id),
          rating: saved.rating,
          topicKey: card.topicKey,
          reviewedAt: String(saved.reviewed_at),
          nextReviewAt: String(saved.next_review_at),
        },
        mastery,
        memorySync,
        memory,
        ...(learningWarning ? { learningWarning } : {}),
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "The review could not be saved.");
  }
}
