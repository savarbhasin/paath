import { NextResponse } from "next/server";

import { DEMO_WORKSPACE_ID, SOURCE_BUCKET } from "@/lib/config";
import { createSupermemoryMemoryProvider } from "@/lib/providers/memory";
import { toProviderError } from "@/lib/providers/types";
import { apiError } from "@/lib/server/http";
import { courseBelongsToWorkspace, getSource } from "@/lib/server/source-repository";
import { supermemoryCustomId } from "@/lib/sources";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const client = createSupabaseAdminClient();
    const source = await getSource(client, id);
    if (!source) return new NextResponse(null, { status: 204 });
    if (!(await courseBelongsToWorkspace(client, source.courseId, DEMO_WORKSPACE_ID))) {
      return apiError("The source was not found.", 404);
    }

    // Keep the row until cleanup succeeds so a failed delete can be retried.
    // The custom id also covers submissions whose response was lost.
    if (source.providerDocumentId || source.status !== "uploading") {
      await createSupermemoryMemoryProvider().deleteSource(
        source.providerDocumentId ?? supermemoryCustomId(source.id),
      );
    }
    if (source.storagePath && source.storagePath !== "pending") {
      const { error } = await client.storage.from(SOURCE_BUCKET).remove([source.storagePath]);
      if (error) throw new Error(`Could not delete the uploaded file: ${error.message}`);
    }
    const { error } = await client.from("sources").delete().eq("id", source.id);
    if (error) throw new Error(`Could not delete the source: ${error.message}`);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(`${toProviderError(error).message} Delete the source again to retry cleanup.`);
  }
}
