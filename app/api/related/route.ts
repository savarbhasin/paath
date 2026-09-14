import { NextResponse } from "next/server";
import { z } from "zod";

import { DEMO_WORKSPACE_ID } from "@/lib/config";
import { createSupermemoryMemoryProvider } from "@/lib/providers/memory";
import { apiError } from "@/lib/server/http";
import { courseBelongsToWorkspace, listSourcesByCourse } from "@/lib/server/source-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import type { JsonValue } from "@/lib/domain";

export type RelatedSource = {
  sourceId: string;
  title: string;
  excerpt: string;
  similarity: number | null;
};

export type RelatedNotebook = {
  notebookId: string;
  title: string;
  excerpt: string;
};

/**
 * Ticket 07 connections between material. Searches a notebook selection
 * against other ready sources in Supermemory (course-scoped) and saved
 * notebook text in Supabase, then returns a short related-material list. The
 * browser opens a source through `/api/sources/:id/open` or selects the
 * notebook in the workspace. Connections are calculated on request — no
 * background graph is built — and course scope is the default, so
 * recommendations never mix unrelated courses.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const courseId = searchParams.get("courseId") ?? "";
  const text = (searchParams.get("text") ?? "").trim();
  const notebookId = searchParams.get("notebookId");

  if (!z.string().uuid().safeParse(courseId).success) {
    return apiError("A valid course id is required.", 400);
  }
  if (!text || text.length > 2000) {
    return apiError("Selected text is required to find related material.", 400);
  }
  if (notebookId && !z.string().uuid().safeParse(notebookId).success) {
    return apiError("Notebook id is invalid.", 400);
  }

  try {
    const client = createSupabaseAdminClient();
    const belongs = await courseBelongsToWorkspace(client, courseId, DEMO_WORKSPACE_ID);
    if (!belongs) return apiError("The course was not found.", 404);

    if (notebookId) {
      const { data: notebook } = await client
        .from("notebooks")
        .select("id")
        .eq("id", notebookId)
        .eq("course_id", courseId)
        .maybeSingle();
      if (!notebook) return apiError("The notebook was not found in this course.", 404);
    }

    const readySources = (await listSourcesByCourse(client, courseId)).filter(
      (source) => source.status === "ready",
    );
    const localById = new Map(readySources.map((source) => [source.id, source]));

    let sources: RelatedSource[] = [];
    if (readySources.length > 0) {
      try {
        const provider = createSupermemoryMemoryProvider();
        const results = await provider.search({
          query: text.slice(0, 500),
          courseId,
          limit: 6,
          allowedSourceIds: readySources.map((source) => source.id),
        });
        const seen = new Set<string>();
        for (const result of results) {
          if (seen.has(result.sourceId) || !localById.has(result.sourceId)) continue;
          seen.add(result.sourceId);
          const local = localById.get(result.sourceId);
          if (!local) continue;
          sources.push({
            sourceId: result.sourceId,
            title: local.title,
            excerpt: result.excerpt.slice(0, 280),
            similarity: result.similarity,
          });
          if (sources.length >= 4) break;
        }
      } catch {
        // Provider search failing still returns notebook matches below.
        sources = [];
      }
    }

    const { data: notebookRows } = await client
      .from("notebooks")
      .select("id, title, content_json")
      .eq("course_id", courseId)
      .limit(50);

    const notebooks: RelatedNotebook[] = [];
    for (const entry of ((notebookRows ?? []) as Record<string, unknown>[])) {
      const id = String(entry.id);
      if (notebookId && id === notebookId) continue;
      const body = notebookText(entry.content_json as JsonValue);
      if (!body) continue;
      const excerpt = matchExcerpt(body, text);
      if (excerpt) {
        notebooks.push({ notebookId: id, title: String(entry.title), excerpt });
      }
      if (notebooks.length >= 3) break;
    }

    return NextResponse.json({ sources, notebooks });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Related material could not be loaded.");
  }
}

/** Flattens a Tiptap document into plain searchable text. */
function notebookText(value: JsonValue): string {
  const parts: string[] = [];
  const walk = (node: JsonValue): void => {
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry);
      return;
    }
    if (node && typeof node === "object") {
      // Generated block nodes carry only artifact ids — skip them so ids and
      // attrs never match a concept query.
      if (typeof node.type === "string" && node.type.endsWith("Block")) return;
      for (const entry of Object.values(node)) walk(entry);
    }
  };
  walk(value);
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 20000);
}

function matchExcerpt(body: string, query: string): string | null {
  const lowered = body.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 4);
  let index = lowered.indexOf(query.toLowerCase().slice(0, 120));
  if (index < 0) {
    for (const token of tokens.slice(0, 6)) {
      index = lowered.indexOf(token);
      if (index >= 0) break;
    }
  }
  if (index < 0) return null;
  const start = Math.max(0, index - 80);
  const end = Math.min(body.length, index + 120);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  return `${prefix}${body.slice(start, end).trim()}${suffix}`.slice(0, 280);
}
