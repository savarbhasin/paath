import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/server/http";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ artifactId: string }> };

export type CardReviewState = {
  cardId: string;
  rating: string;
  reviewedAt: string;
  nextReviewAt: string;
};

/**
 * Returns the latest review per card so a deck reopens with its due dates
 * after reload. Ticket 06 reads the same rows for mastery evidence.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { artifactId } = await context.params;
  if (!z.string().uuid().safeParse(artifactId).success) {
    return apiError("Artifact id is invalid.", 400);
  }

  try {
    const client = createSupabaseAdminClient();
    const { data, error } = await client
      .from("flashcard_reviews")
      .select("card_id, rating, reviewed_at, next_review_at")
      .eq("artifact_id", artifactId)
      .order("reviewed_at", { ascending: false });
    if (error) throw new Error(`Could not load reviews: ${error.message}`);

    const latest = new Map<string, CardReviewState>();
    for (const entry of (data ?? []) as Record<string, unknown>[]) {
      const cardId = String(entry.card_id);
      if (latest.has(cardId)) continue;
      latest.set(cardId, {
        cardId,
        rating: String(entry.rating),
        reviewedAt: String(entry.reviewed_at),
        nextReviewAt: String(entry.next_review_at),
      });
    }
    return NextResponse.json({ reviews: [...latest.values()] });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not load reviews.");
  }
}
