import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/server/http";
import { getThread, listRecentMessages } from "@/lib/server/chat-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

/** Returns recent persisted messages for a thread, oldest first. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) {
      return apiError("Thread id is invalid.", 400);
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 20) || 20, 1), 30);

    const client = createSupabaseAdminClient();
    const thread = await getThread(client, id);
    if (!thread) return apiError("The chat thread was not found.", 404);

    const messages = await listRecentMessages(client, id, limit);
    return NextResponse.json({ thread, messages });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not load chat history.");
  }
}
