import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson } from "@/lib/server/http";
import { getOrCreateThread, listThreads } from "@/lib/server/chat-repository";
import { courseBelongsToWorkspace } from "@/lib/server/source-repository";
import { DEMO_WORKSPACE_ID } from "@/lib/config";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const listQuery = z.object({
  courseId: z.string().uuid(),
  notebookId: z.string().uuid().nullable().optional(),
});

/** Lists recent threads for a course (optionally scoped to a notebook). */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const input = listQuery.parse({
      courseId: searchParams.get("courseId"),
      notebookId: searchParams.get("notebookId"),
    });

    const client = createSupabaseAdminClient();
    const belongs = await courseBelongsToWorkspace(client, input.courseId, DEMO_WORKSPACE_ID);
    if (!belongs) return apiError("The course was not found.", 404);

    const threads = await listThreads(client, { courseId: input.courseId, notebookId: input.notebookId ?? null });
    return NextResponse.json({ threads });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError("A valid courseId is required.", 400);
    }
    return apiError(error instanceof Error ? error.message : "Could not list chat threads.");
  }
}

const createInput = z.object({
  courseId: z.string().uuid(),
  notebookId: z.string().uuid().nullable().optional(),
  question: z.string().trim().min(1).max(2000).default("Notebook chat"),
});

/** Returns the active thread for a course/notebook pair, creating one when needed. */
export async function POST(request: Request) {
  try {
    const input = createInput.parse(await readJson(request));
    const client = createSupabaseAdminClient();
    const belongs = await courseBelongsToWorkspace(client, input.courseId, DEMO_WORKSPACE_ID);
    if (!belongs) return apiError("The course was not found.", 404);

    const thread = await getOrCreateThread(client, {
      courseId: input.courseId,
      notebookId: input.notebookId ?? null,
      question: input.question,
    });
    return NextResponse.json({ thread }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError("A valid course and question are required.", 400);
    }
    return apiError(error instanceof Error ? error.message : "Could not start the chat thread.");
  }
}
