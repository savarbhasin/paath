import { NextResponse } from "next/server";

import { DEMO_WORKSPACE_ID } from "@/lib/config";
import { createSupermemoryMemoryProvider } from "@/lib/providers/memory";
import { toProviderError } from "@/lib/providers/types";
import { apiError } from "@/lib/server/http";
import { userFacingProviderMessage } from "@/lib/server/source-ingestion";
import {
  courseBelongsToWorkspace,
  listSourcesByCourse,
  listSourcesByCourseIds,
  listWorkspaceCourseIds,
} from "@/lib/server/source-repository";
import type { SearchScope } from "@/lib/sources";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Searches ready sources through Supermemory. Course scope (the default)
 * filters provider-side by `courseId` and re-checks locally; workspace scope
 * searches every ready source in the workspace.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("q") ?? "").trim();
    const scope = (searchParams.get("scope") ?? "course") as SearchScope;
    const courseId = searchParams.get("courseId");
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 8) || 8, 1), 20);

    if (!query) {
      return apiError("A search query is required.", 400);
    }
    if (scope !== "course" && scope !== "workspace") {
      return apiError("Scope must be course or workspace.", 400);
    }

    const client = createSupabaseAdminClient();

    if (scope === "course") {
      if (!courseId) return apiError("A courseId is required for course search.", 400);
      const belongs = await courseBelongsToWorkspace(client, courseId, DEMO_WORKSPACE_ID);
      if (!belongs) return apiError("The course was not found.", 404);
    } else if (courseId) {
      const belongs = await courseBelongsToWorkspace(client, courseId, DEMO_WORKSPACE_ID);
      if (!belongs) return apiError("The course was not found.", 404);
    }

    const localSources =
      scope === "course" && courseId
        ? await listSourcesByCourse(client, courseId)
        : await listSourcesByCourseIds(client, await listWorkspaceCourseIds(client, DEMO_WORKSPACE_ID));

    const readySources = localSources.filter((source) => source.status === "ready");
    if (readySources.length === 0) {
      return NextResponse.json({ results: [], readySources: 0, scope, diagnostic: null });
    }

    const localById = new Map(readySources.map((source) => [source.id, source]));
    const provider = createSupermemoryMemoryProvider();

    try {
      const results = await provider.search({
        query,
        courseId: scope === "course" && courseId ? courseId : undefined,
        limit,
        allowedSourceIds: readySources.map((source) => source.id),
      });

      // Join against local records so titles come from the workspace and only
      // ready sources are ever rendered.
      const enriched = results.flatMap((result) => {
        const local = localById.get(result.sourceId);
        if (!local) return [];
        return [{ ...result, title: local.title, courseId: local.courseId }];
      });

      return NextResponse.json({ results: enriched, readySources: readySources.length, scope, diagnostic: null });
    } catch (error) {
      const providerError = toProviderError(error);
      return NextResponse.json(
        {
          error: userFacingProviderMessage(providerError.code, providerError.message),
          providerCode: providerError.code,
          results: [],
          readySources: readySources.length,
          scope,
        },
        { status: 502 },
      );
    }
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Search failed.");
  }
}
