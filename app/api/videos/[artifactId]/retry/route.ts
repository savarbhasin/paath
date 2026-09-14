import { NextResponse } from "next/server";
import { z } from "zod";

import { DEMO_WORKSPACE_ID } from "@/lib/config";
import { apiError, readJson } from "@/lib/server/http";
import { courseBelongsToWorkspace } from "@/lib/server/source-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ artifactId: string }> };

const retryInput = z.object({
  courseId: z.string().uuid(),
});

/**
 * Re-queues a failed video job in place via `retry_video_job`, preserving
 * the checkpoint snapshot so the worker resumes from the last valid stage.
 * The same artifact row is kept, so the Videos list never duplicates.
 */
export async function POST(request: Request, context: RouteContext) {
  const { artifactId } = await context.params;
  if (!z.string().uuid().safeParse(artifactId).success) {
    return apiError("Artifact id is invalid.", 400);
  }

  let input: z.infer<typeof retryInput>;
  try {
    input = retryInput.parse(await readJson(request));
  } catch {
    return apiError("A valid courseId is required.", 400);
  }

  try {
    const client = createSupabaseAdminClient();
    const belongs = await courseBelongsToWorkspace(client, input.courseId, DEMO_WORKSPACE_ID);
    if (!belongs) return apiError("The course was not found.", 404);

    const { data: existing, error: loadError } = await client
      .from("learning_artifacts")
      .select("id, course_id, kind, status")
      .eq("id", artifactId)
      .single();
    if (loadError || !existing) return apiError("The video was not found.", 404);

    const row = existing as Record<string, unknown>;
    if (String(row.course_id) !== input.courseId || row.kind !== "video") {
      return apiError("The video was not found.", 404);
    }

    const { data, error } = await client.rpc("retry_video_job", { p_artifact_id: artifactId });
    if (error) throw new Error(`The video could not be retried: ${error.message}`);
    if (data !== true) {
      return NextResponse.json(
        { error: "Only failed videos can be retried.", retryable: false },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      artifact: { id: artifactId, status: "generating" },
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "The video could not be retried.");
  }
}
