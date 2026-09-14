import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupermemoryMemoryProvider } from "@/lib/providers/memory";
import { apiError } from "@/lib/server/http";
import { completeStudySession, enrichStudySession } from "@/lib/server/study-sessions";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Ticket 07: completes the Study Mode sequence. Quiz, review, and mastery
 * records were already written by the normal routes during the steps; this
 * writes exactly one `study_complete` memory event. The guarded status flip
 * makes repeat completions return the finished session without a second
 * event write.
 */
export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError("Session id is invalid.", 400);
  }

  try {
    const client = createSupabaseAdminClient();
    const memory = createSupermemoryMemoryProvider();
    const { session, alreadyCompleted, memoryWarning } = await completeStudySession(client, memory, id);
    return NextResponse.json({
      session: await enrichStudySession(client, session),
      alreadyCompleted,
      ...(memoryWarning ? { memoryWarning } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The study session could not be completed.";
    const status = /not found/i.test(message) ? 404 : /already finished/i.test(message) ? 409 : 500;
    return apiError(message, status);
  }
}
