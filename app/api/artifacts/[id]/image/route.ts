import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/server/http";
import { getGeneratedImageUrl } from "@/lib/server/visual-generation";
import { imagePayloadSchema } from "@/lib/tutor";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Returns a fresh short-lived signed URL for a generated image block. The
 * browser renders from this URL; only the storage path is ever persisted, so
 * images survive reload without relying on temporary provider URLs.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError("Artifact id is invalid.", 400);
  }

  try {
    const client = createSupabaseAdminClient();
    const { data, error } = await client
      .from("learning_artifacts")
      .select("id, kind, status, payload_json")
      .eq("id", id)
      .single();
    if (error || !data) return apiError("The image was not found.", 404);

    const row = data as Record<string, unknown>;
    if (row.kind !== "image") return apiError("This block is not an image.", 400);
    if (row.status !== "ready") return apiError("This image is not ready yet.", 409);

    const parsed = imagePayloadSchema.safeParse(row.payload_json ?? {});
    if (!parsed.success) return apiError("This image is missing its stored file.", 404);

    const url = await getGeneratedImageUrl(client, parsed.data.storagePath);
    if (!url) return apiError("The image could not be opened from storage.", 503);
    return NextResponse.json({ url, storagePath: parsed.data.storagePath });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not open the image.");
  }
}
