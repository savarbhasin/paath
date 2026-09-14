import { NextResponse } from "next/server";
import { z } from "zod";

import { DEMO_WORKSPACE_ID } from "@/lib/config";
import { apiError } from "@/lib/server/http";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Ticket 07 review-queue completion for misconceptions. Flashcards reschedule
 * through the flashcard review route and wrong questions through quiz
 * resubmission; misconceptions had no completion path, so resolving one here
 * removes it from the queue and dashboard. Course isolation is enforced by
 * joining the parent course's workspace before updating.
 */
export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError("Misconception id is invalid.", 400);
  }

  try {
    const client = createSupabaseAdminClient();
    const { data: row, error: loadError } = await client
      .from("misconceptions")
      .select("id, course_id, status")
      .eq("id", id)
      .single();
    if (loadError || !row) return apiError("The misconception was not found.", 404);
    const record = row as Record<string, unknown>;

    const { data: course } = await client
      .from("courses")
      .select("id")
      .eq("id", String(record.course_id))
      .eq("workspace_id", DEMO_WORKSPACE_ID)
      .maybeSingle();
    if (!course) return apiError("The misconception was not found.", 404);

    if (record.status === "resolved") {
      return NextResponse.json({ id: String(record.id), status: "resolved", alreadyResolved: true });
    }

    const { data: updated, error: updateError } = await client
      .from("misconceptions")
      .update({ status: "resolved" })
      .eq("id", id)
      .select("id, status")
      .single();
    if (updateError) return apiError(`The misconception could not be resolved: ${updateError.message}`);
    const saved = updated as Record<string, unknown>;
    return NextResponse.json({ id: String(saved.id), status: String(saved.status), alreadyResolved: false });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "The misconception could not be resolved.");
  }
}
