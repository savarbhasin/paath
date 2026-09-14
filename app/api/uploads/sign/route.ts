import { NextResponse } from "next/server";
import { z } from "zod";

import { DEMO_WORKSPACE_ID, SOURCE_BUCKET } from "@/lib/config";
import { apiError, readJson } from "@/lib/server/http";
import {
  courseBelongsToWorkspace,
  createSource,
  updateSource,
} from "@/lib/server/source-repository";
import { buildSourceStoragePath, validateSourceFile } from "@/lib/sources";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const signInput = z.object({
  courseId: z.string().uuid(),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(127),
  size: z.number().int().nonnegative(),
  title: z.string().trim().min(1).max(160).optional(),
});

function titleFromFilename(filename: string): string {
  const base = filename.split(/[?#]/, 1)[0].split("/").pop() ?? filename;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.trim().slice(0, 160) || "Untitled source";
}

/**
 * Creates the local source record and returns a signed upload token so the
 * browser can PUT the file directly to private Supabase Storage. Type and
 * size checks fail here, before anything is uploaded.
 */
export async function POST(request: Request) {
  try {
    const input = signInput.parse(await readJson(request));
    const validation = validateSourceFile({ filename: input.filename, mimeType: input.mimeType, size: input.size });
    if (!validation.ok) {
      return apiError(validation.reason ?? "Unsupported file.", 400);
    }

    const client = createSupabaseAdminClient();
    const belongs = await courseBelongsToWorkspace(client, input.courseId, DEMO_WORKSPACE_ID);
    if (!belongs) {
      return apiError("The course was not found.", 404);
    }

    const source = await createSource(client, {
      courseId: input.courseId,
      type: validation.extension === "pdf" ? "pdf" : "file",
      title: input.title?.trim() || titleFromFilename(input.filename),
      storagePath: "pending",
    });

    const storagePath = buildSourceStoragePath(input.courseId, source.id, validation.extension);
    const { data: signed, error: signError } = await client.storage
      .from(SOURCE_BUCKET)
      .createSignedUploadUrl(storagePath);

    if (signError || !signed?.signedUrl || !signed.token) {
      await client.from("sources").delete().eq("id", source.id);
      return apiError("Storage could not issue an upload token. Try again.", 503);
    }

    const withPath = await updateSource(client, source.id, { storagePath });

    return NextResponse.json(
      { source: withPath, storagePath, signedUrl: signed.signedUrl, token: signed.token },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError("A valid course, filename, MIME type, and size are required.", 400);
    }
    return apiError(error instanceof Error ? error.message : "Could not prepare the upload.");
  }
}
