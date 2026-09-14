import { NextResponse } from "next/server";
import { z } from "zod";

import { DEMO_WORKSPACE_ID } from "@/lib/config";
import { apiError, readJson } from "@/lib/server/http";
import { courseBelongsToWorkspace } from "@/lib/server/source-repository";
import { createStudySession, enrichStudySession, getActiveStudySession } from "@/lib/server/study-sessions";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const createInput = z.object({ courseId: z.string().uuid() });

/**
 * Ticket 07 Study Mode creation. Builds the fixed recap → flashcards →
 * practice → result sequence from existing course evidence (due cards, latest
 * ready assessment, weak topics, misconceptions) with no provider calls. An
 * already-active session is resumed instead of duplicated.
 */
export async function POST(request: Request) {
  let input: z.infer<typeof createInput>;
  try {
    input = createInput.parse(await readJson(request));
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("A valid course id is required.", 400);
    return apiError("Request body must be valid JSON.", 400);
  }

  try {
    const client = createSupabaseAdminClient();
    const belongs = await courseBelongsToWorkspace(client, input.courseId, DEMO_WORKSPACE_ID);
    if (!belongs) return apiError("The course was not found.", 404);

    const { session, created } = await createStudySession(client, input.courseId);
    const enriched = await enrichStudySession(client, session);
    return NextResponse.json({ session: enriched, created }, { status: created ? 201 : 200 });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "The study session could not be started.");
  }
}

/**
 * Resume-after-reload: returns the course's active session (if any) with its
 * step content, so leaving and returning continues the same sequence.
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

    const session = await getActiveStudySession(client, courseId);
    if (!session) return NextResponse.json({ session: null });
    return NextResponse.json({ session: await enrichStudySession(client, session) });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "The study session could not be loaded.");
  }
}
