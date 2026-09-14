import { NextResponse } from "next/server";

import { apiError } from "@/lib/server/http";
import { getReadableSourceUrl } from "@/lib/server/source-ingestion";
import { getSource } from "@/lib/server/source-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Opens a source behind a result: a fresh short-lived signed URL for private
 * files, or the canonical URL for YouTube sources. Never a stored stale URL.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const source = await getSource(createSupabaseAdminClient(), id);
    if (!source) {
      return apiError("The source was not found.", 404);
    }

    if (source.type === "youtube") {
      if (!source.url) return apiError("This source has no URL.", 404);
      return NextResponse.json({ url: source.url, kind: "youtube", source });
    }

    const url = await getReadableSourceUrl(createSupabaseAdminClient(), source, 5 * 60);
    if (!url) {
      return apiError("The file could not be opened from storage.", 503);
    }
    return NextResponse.json({ url, kind: "file", source });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not open the source.");
  }
}
