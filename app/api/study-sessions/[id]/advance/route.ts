import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson } from "@/lib/server/http";
import { advanceStudyStep, enrichStudySession } from "@/lib/server/study-sessions";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

const advanceInput = z.object({
  stepKey: z.string().min(1).max(60),
  status: z.enum(["complete", "skipped"]),
});

/**
 * Ticket 07: marks one Study Mode step complete or skipped and activates the
 * next pending step. Step scoring itself happens through the normal flashcard
 * review and assessment submit routes — this endpoint only tracks progress.
 */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError("Session id is invalid.", 400);
  }

  let input: z.infer<typeof advanceInput>;
  try {
    input = advanceInput.parse(await readJson(request));
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("A valid step key and status (complete, skipped) are required.", 400);
    return apiError("Request body must be valid JSON.", 400);
  }

  try {
    const client = createSupabaseAdminClient();
    const session = await advanceStudyStep(client, id, input.stepKey, input.status);
    return NextResponse.json({ session: await enrichStudySession(client, session) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The study step could not be updated.";
    const status = /not found/i.test(message) ? 404 : /already finished|result step/i.test(message) ? 409 : 500;
    return apiError(message, status);
  }
}
