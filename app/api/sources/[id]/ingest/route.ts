import { NextResponse } from "next/server";

import { apiError } from "@/lib/server/http";
import {
  getReadableSourceUrl,
  storageObjectExists,
  submitSourceForIngestion,
} from "@/lib/server/source-ingestion";
import { getSource, updateSource } from "@/lib/server/source-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Confirms a direct-to-storage upload finished, then submits the stored file
 * (or YouTube URL) to Supermemory.
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const client = createSupabaseAdminClient();
    const source = await getSource(client, id);
    if (!source) {
      return apiError("The source was not found.", 404);
    }

    if (source.type !== "youtube") {
      if (!source.storagePath || source.storagePath === "pending") {
        return apiError("The upload has not started yet.", 400);
      }
      const exists = await storageObjectExists(client, source.storagePath);
      if (!exists) {
        const failed = await updateSource(client, source.id, {
          status: "failed",
          error: "The file did not reach storage. Upload it again, then retry.",
        });
        return NextResponse.json({ source: failed }, { status: 409 });
      }
      // Touch the read path once so a storage permission problem surfaces
      // as a clear message instead of a silent ingestion stall.
      const readable = await getReadableSourceUrl(client, source);
      if (!readable) {
        const failed = await updateSource(client, source.id, {
          status: "failed",
          error: "Storage refused a read URL for the file. Check the bucket policy, then retry.",
        });
        return NextResponse.json({ source: failed }, { status: 503 });
      }
    }

    const submitted = await submitSourceForIngestion(client, source);
    return NextResponse.json({ source: submitted });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not start ingestion.");
  }
}
