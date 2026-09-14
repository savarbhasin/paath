import { NextResponse } from "next/server";
import { z } from "zod";

import { DEMO_WORKSPACE_ID } from "@/lib/config";
import { createSupermemoryMemoryProvider } from "@/lib/providers/memory";
import { apiError, readJson } from "@/lib/server/http";
import { memorySyncSummary, recordAndSyncEvent } from "@/lib/server/learner-memory";
import { courseBelongsToWorkspace } from "@/lib/server/source-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const preferenceInput = z.object({
  courseId: z.string().uuid(),
  text: z.string().trim().min(1).max(280),
});

/**
 * Ticket 06 explicit study preferences. The preference is stored as a local
 * learning event first, then synced to Supermemory so the remote profile can
 * absorb it. A failed sync never rolls back the stored preference.
 */
export async function POST(request: Request) {
  let input: z.infer<typeof preferenceInput>;
  try {
    input = preferenceInput.parse(await readJson(request));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError("A valid course and a short preference are required.", 400);
    }
    return apiError("Request body must be valid JSON.", 400);
  }

  try {
    const client = createSupabaseAdminClient();
    const belongs = await courseBelongsToWorkspace(client, input.courseId, DEMO_WORKSPACE_ID);
    if (!belongs) return apiError("The course was not found.", 404);

    const memory = createSupermemoryMemoryProvider();
    const { event, sync } = await recordAndSyncEvent(client, memory, {
      courseId: input.courseId,
      kind: "preference",
      payload: { text: input.text },
    });
    const summary = await memorySyncSummary(client, input.courseId);

    return NextResponse.json(
      {
        preference: { id: event.id, text: input.text, createdAt: event.createdAt },
        memorySync: sync,
        memory: summary,
      },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "The preference could not be saved.");
  }
}
