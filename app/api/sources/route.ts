import { NextResponse } from "next/server";

import { DEMO_WORKSPACE_ID } from "@/lib/config";
import { apiError } from "@/lib/server/http";
import { courseBelongsToWorkspace, listSourcesByCourse } from "@/lib/server/source-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get("courseId");
    if (!courseId) {
      return apiError("A courseId query parameter is required.", 400);
    }

    const client = createSupabaseAdminClient();
    const belongs = await courseBelongsToWorkspace(client, courseId, DEMO_WORKSPACE_ID);
    if (!belongs) {
      return apiError("The course was not found.", 404);
    }

    const sources = await listSourcesByCourse(client, courseId);
    return NextResponse.json({ sources });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not list sources.");
  }
}
