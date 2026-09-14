import { NextResponse } from "next/server";
import { z } from "zod";

import { DEMO_WORKSPACE_ID } from "@/lib/config";
import { apiError } from "@/lib/server/http";
import { courseBelongsToWorkspace } from "@/lib/server/source-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { VIDEO_BUCKET, videoPayloadSchema } from "@/lib/video";

type RouteContext = { params: Promise<{ artifactId: string }> };

/**
 * Loads a course video artifact with fresh signed playback URLs. Validates
 * the courseId query, the course's workspace membership, and that the
 * artifact belongs to the course and is a video. Storage keys must live
 * under `{courseId}/{artifactId}/` so a cross-course artifact pointer can
 * never resolve to another course's media. Signing failures are rejected
 * (503) rather than reported as ready-with-null media.
 */
export async function GET(request: Request, context: RouteContext) {
  const { artifactId } = await context.params;
  if (!z.string().uuid().safeParse(artifactId).success) {
    return apiError("Artifact id is invalid.", 400);
  }

  const { searchParams } = new URL(request.url);
  const courseId = searchParams.get("courseId") ?? "";
  if (!z.string().uuid().safeParse(courseId).success) {
    return apiError("A valid courseId is required.", 400);
  }

  try {
    const client = createSupabaseAdminClient();
    const belongs = await courseBelongsToWorkspace(client, courseId, DEMO_WORKSPACE_ID);
    if (!belongs) return apiError("The course was not found.", 404);

    const { data, error } = await client
      .from("learning_artifacts")
      .select("id, course_id, kind, status, payload_json, error")
      .eq("id", artifactId)
      .single();
    if (error || !data) return apiError("The video was not found.", 404);

    const row = data as Record<string, unknown>;
    if (String(row.course_id) !== courseId || row.kind !== "video") {
      return apiError("The video was not found.", 404);
    }

    const parsed = videoPayloadSchema.safeParse(row.payload_json ?? {});
    if (!parsed.success) return apiError("This video is missing its stored data.", 404);

    if (row.status === "ready" && !parsed.data.videoKey) return apiError("This video is missing its stored file.", 503);

    const prefix = `${courseId}/${artifactId}/`;
    const keys = [parsed.data.videoKey, parsed.data.captionsKey].filter(
      (key): key is string => typeof key === "string" && key.length > 0,
    );
    for (const key of keys) {
      if (!key.startsWith(prefix) || key.includes("..")) {
        return apiError("This video is missing its stored file.", 404);
      }
    }

    const sign = async (key: string | undefined, label: string): Promise<string | null> => {
      if (!key) return null;
      const { data: signed, error: signError } = await client.storage
        .from(VIDEO_BUCKET)
        .createSignedUrl(key, 3600);
      if (signError || !signed?.signedUrl) {
        throw new Error(`The ${label} could not be opened from storage.`);
      }
      return signed.signedUrl;
    };

    let videoUrl: string | null;
    let captionsUrl: string | null;
    try {
      [videoUrl, captionsUrl] = await Promise.all([
        sign(parsed.data.videoKey, "video"),
        sign(parsed.data.captionsKey, "captions file"),
      ]);
    } catch (signError) {
      return apiError(
        signError instanceof Error ? signError.message : "The video could not be opened from storage.",
        503,
      );
    }

    return NextResponse.json({
      artifact: {
        id: String(row.id),
        status: typeof row.status === "string" ? row.status : "generating",
        payload: parsed.data,
      },
      videoUrl,
      captionsUrl,
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not open the video.");
  }
}
