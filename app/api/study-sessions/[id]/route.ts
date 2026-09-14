import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/server/http";
import { enrichStudySession, getStudySession } from "@/lib/server/study-sessions";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

/** Ticket 07: reads one persisted Study Mode session with its step content. */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError("Session id is invalid.", 400);
  }

  try {
    const client = createSupabaseAdminClient();
    const session = await getStudySession(client, id);
    if (!session) return apiError("The study session was not found.", 404);
    return NextResponse.json({ session: await enrichStudySession(client, session) });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "The study session could not be loaded.");
  }
}
