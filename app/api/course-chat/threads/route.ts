import { NextResponse } from "next/server";
import { z } from "zod";

import { DEMO_WORKSPACE_ID } from "@/lib/config";
import { apiError } from "@/lib/server/http";
import { listCourseThreads } from "@/lib/server/course-chat";
import { courseBelongsToWorkspace } from "@/lib/server/source-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { createThread } from "@/lib/server/chat-repository";

/** Lists course-level chat threads (`notebook_id` null) for one course. */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get("courseId") ?? "";
    if (!z.string().uuid().safeParse(courseId).success) {
      return apiError("A valid courseId is required.", 400);
    }

    const client = createSupabaseAdminClient();
    const belongs = await courseBelongsToWorkspace(client, courseId, DEMO_WORKSPACE_ID);
    if (!belongs) return apiError("The course was not found.", 404);

    const offset = z.coerce.number().int().min(0).parse(searchParams.get("offset") ?? 0);
    const threads = await listCourseThreads(client, courseId, offset);
    return NextResponse.json({ threads });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not list course threads.");
  }
}

/** Starts a brand-new course-level thread (explicit "New chat"). Unlike the
 *  chat turn route, this never resumes the most recent thread. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { courseId?: string };
    const courseId = body.courseId ?? "";
    if (!z.string().uuid().safeParse(courseId).success) {
      return apiError("A valid courseId is required.", 400);
    }

    const client = createSupabaseAdminClient();
    const belongs = await courseBelongsToWorkspace(client, courseId, DEMO_WORKSPACE_ID);
    if (!belongs) return apiError("The course was not found.", 404);

    const thread = await createThread(client, { courseId, notebookId: null });
    return NextResponse.json({ thread }, { status: 201 });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not start a new chat.");
  }
}
