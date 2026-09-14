import { NextResponse } from "next/server";

import { apiError } from "@/lib/server/http";
import { createSupermemoryMemoryProvider } from "@/lib/providers/memory";
import { toProviderError } from "@/lib/providers/types";
import { userFacingProviderMessage } from "@/lib/server/source-ingestion";
import { getSource, updateSource } from "@/lib/server/source-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Reconciles the local source status with Supermemory. Provider failures are
 * returned as a user-visible diagnostic instead of failing the request, so
 * polling can keep showing the last known state with a warning.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const client = createSupabaseAdminClient();
    const source = await getSource(client, id);
    if (!source) {
      return apiError("The source was not found.", 404);
    }

    if (!source.providerDocumentId) {
      return NextResponse.json({ source, providerStatus: null, diagnostic: null });
    }

    if (source.status === "ready") {
      return NextResponse.json({ source, providerStatus: "ready", diagnostic: null });
    }

    try {
      const provider = createSupermemoryMemoryProvider();
      const providerStatus = await provider.getSourceStatus(source.providerDocumentId);

      if (providerStatus === "ready") {
        const updated = await updateSource(client, source.id, { status: "ready", error: null });
        return NextResponse.json({ source: updated, providerStatus, diagnostic: null });
      }
      if (providerStatus === "failed") {
        const updated = await updateSource(client, source.id, {
          status: "failed",
          error: "Supermemory could not process this source. It stays visible and can be retried.",
        });
        return NextResponse.json({ source: updated, providerStatus, diagnostic: null });
      }
      if ((providerStatus === "queued" || providerStatus === "processing") && source.status !== providerStatus) {
        const updated = await updateSource(client, source.id, { status: providerStatus, error: null });
        return NextResponse.json({ source: updated, providerStatus, diagnostic: null });
      }
      return NextResponse.json({ source, providerStatus, diagnostic: null });
    } catch (error) {
      const providerError = toProviderError(error);
      return NextResponse.json({
        source,
        providerStatus: null,
        diagnostic: {
          code: providerError.code,
          message: userFacingProviderMessage(providerError.code, providerError.message),
        },
      });
    }
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not read source status.");
  }
}
