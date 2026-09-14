import { NextResponse } from "next/server";
import { z } from "zod";

import { loadReadyAssessment } from "@/lib/server/assessment-results";
import { apiError } from "@/lib/server/http";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Returns persisted attempts newest-first so a completed quiz or practice
 * set reopens with its results, explanations, and per-question topic keys
 * after reload.
 */
export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError("Artifact id is invalid.", 400);
  }

  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 5) || 5, 1), 20);

    const client = createSupabaseAdminClient();
    await loadReadyAssessment(client, id);

    const { data, error } = await client
      .from("quiz_attempts")
      .select("id, answers_json, results_json, score, submitted_at")
      .eq("artifact_id", id)
      .order("submitted_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Could not load attempts: ${error.message}`);

    const attempts = ((data ?? []) as Record<string, unknown>[]).map((entry) => ({
      id: String(entry.id),
      answers: (entry.answers_json ?? {}) as Record<string, string[]>,
      results: (entry.results_json ?? {}) as unknown,
      score: Number(entry.score),
      submittedAt: String(entry.submitted_at),
    }));
    return NextResponse.json({ attempts });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load attempts.";
    const status = /not found/i.test(message) ? 404 : /malformed/i.test(message) ? 422 : 500;
    return apiError(message, status);
  }
}
