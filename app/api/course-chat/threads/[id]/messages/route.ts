import { NextResponse } from "next/server";
import { z } from "zod";
import { DEMO_WORKSPACE_ID } from "@/lib/config";
import { getThread, listCourseMessages } from "@/lib/server/chat-repository";
import { apiError } from "@/lib/server/http";
import { courseBelongsToWorkspace } from "@/lib/server/source-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const offset = z.coerce.number().int().min(0).parse(new URL(request.url).searchParams.get("offset") ?? 0);
    if (!z.string().uuid().safeParse(id).success) return apiError("Thread id is invalid.", 400);
    const client = createSupabaseAdminClient();
    const thread = await getThread(client, id);
    if (!thread || thread.notebookId !== null || !await courseBelongsToWorkspace(client, thread.courseId, DEMO_WORKSPACE_ID)) {
      return apiError("The course conversation was not found.", 404);
    }
    const messages = await listCourseMessages(client, id, offset);
    return NextResponse.json({ messages });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not load the conversation.");
  }
}
