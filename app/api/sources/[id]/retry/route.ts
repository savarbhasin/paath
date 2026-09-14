import { NextResponse } from "next/server";

import { SOURCE_BUCKET } from "@/lib/config";
import { apiError } from "@/lib/server/http";
import { storageObjectExists, submitSourceForIngestion } from "@/lib/server/source-ingestion";
import { getSource, updateSource } from "@/lib/server/source-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Retries a failed or stalled ingestion with the same local source id (and
 * therefore the same Supermemory `customId`). A file that never reached
 * storage gets a fresh upload token instead.
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const client = createSupabaseAdminClient();
    const source = await getSource(client, id);
    if (!source) {
      return apiError("The source was not found.", 404);
    }

    if (source.status === "ready") {
      return NextResponse.json({ source });
    }

    const retrying = await updateSource(client, source.id, { status: "retrying", error: null });

    if (source.type !== "youtube" && (!source.storagePath || !(await storageObjectExists(client, source.storagePath)))) {
      const { data: signed, error: signError } = await client.storage
        .from(SOURCE_BUCKET)
        .createSignedUploadUrl(source.storagePath ?? `${source.courseId}/${source.id}.pdf`);

      if (signError || !signed?.signedUrl || !signed.token) {
        const failed = await updateSource(client, source.id, {
          status: "failed",
          error: "Storage could not issue a new upload token. Try again.",
        });
        return NextResponse.json({ source: failed }, { status: 503 });
      }
      const uploading = await updateSource(client, source.id, { status: "uploading", error: null });
      return NextResponse.json({
        source: uploading,
        storagePath: signed.path,
        signedUrl: signed.signedUrl,
        token: signed.token,
      });
    }

    const submitted = await submitSourceForIngestion(client, retrying);
    return NextResponse.json({ source: submitted });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not retry ingestion.");
  }
}
