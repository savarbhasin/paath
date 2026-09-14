import { NextResponse } from "next/server";
import { z } from "zod";

import { DEMO_WORKSPACE_ID } from "@/lib/config";
import { apiError, readJson } from "@/lib/server/http";
import { submitSourceForIngestion } from "@/lib/server/source-ingestion";
import { courseBelongsToWorkspace, createSource } from "@/lib/server/source-repository";
import { normalizeYouTubeUrl } from "@/lib/sources";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const youtubeInput = z.object({
  courseId: z.string().uuid(),
  url: z.string().trim().min(1).max(2048),
  title: z.string().trim().min(1).max(160).optional(),
});

/**
 * Accepts a public YouTube URL, stores it as a source record, and submits it
 * through the same status model as file uploads.
 */
export async function POST(request: Request) {
  try {
    const input = youtubeInput.parse(await readJson(request));
    const normalized = normalizeYouTubeUrl(input.url);
    if (!normalized.ok || !normalized.url) {
      return apiError(normalized.reason ?? "That YouTube URL is not supported.", 400);
    }

    const client = createSupabaseAdminClient();
    const belongs = await courseBelongsToWorkspace(client, input.courseId, DEMO_WORKSPACE_ID);
    if (!belongs) {
      return apiError("The course was not found.", 404);
    }

    const created = await createSource(client, {
      courseId: input.courseId,
      type: "youtube",
      title: input.title?.trim() || "YouTube lecture",
      url: normalized.url,
    });

    const source = await submitSourceForIngestion(client, created);
    return NextResponse.json({ source }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError("A valid course and YouTube URL are required.", 400);
    }
    return apiError(error instanceof Error ? error.message : "Could not add the YouTube source.");
  }
}
