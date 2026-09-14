import { NextResponse } from "next/server";
import { z } from "zod";

import type { ArtifactEnvelope } from "@/lib/contracts";
import { apiError } from "@/lib/server/http";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

/**
 * Hydrates generated blocks (e.g. explanation nodes) after reload.
 * Supports ?notebookId=<uuid> for the editor and ?id=<uuid> for one artifact.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const notebookId = searchParams.get("notebookId");
    const id = searchParams.get("id");

    if (notebookId && !z.string().uuid().safeParse(notebookId).success) {
      return apiError("Notebook id is invalid.", 400);
    }
    if (id && !z.string().uuid().safeParse(id).success) {
      return apiError("Artifact id is invalid.", 400);
    }
    if (!notebookId && !id) {
      return apiError("A notebookId or id is required.", 400);
    }

    const client = createSupabaseAdminClient();
    let query = client
      .from("learning_artifacts")
      .select("id, course_id, notebook_id, kind, status, payload_json, source_ids, error")
      .order("created_at", { ascending: true });

    query = notebookId ? query.eq("notebook_id", notebookId) : query.eq("id", id as string);

    const { data, error } = await query;
    if (error) {
      throw new Error(`Could not load artifacts: ${error.message}`);
    }

    const artifacts: Array<ArtifactEnvelope & { status: string; error: string | null }> = (data ?? []).map((entry) => {
      const row = entry as Row;
      const payload = (row.payload_json ?? {}) as Record<string, unknown>;
      const kind = row.kind as ArtifactEnvelope["kind"];
      return {
        id: String(row.id),
        kind,
        // The node attrs cache the display title; payload_json stays a pure
        // kind payload so Structured-Output validation never drifts.
        title: titleForKind(kind, payload),
        sourceIds: Array.isArray(row.source_ids) ? (row.source_ids as string[]) : [],
        topicKeys: [],
        citations: [],
        payload,
        // Visual blocks (ticket 04) need lifecycle + failure text to render
        // loading / failed / retrying / complete states after reload.
        status: typeof row.status === "string" ? row.status : "ready",
        error: row.error == null ? null : String(row.error),
      };
    });

    if (id) {
      if (artifacts.length === 0) return apiError("The artifact was not found.", 404);
      const single = artifacts[0];
      return NextResponse.json({ artifact: single, status: single.status, error: single.error });
    }
    return NextResponse.json({ artifacts });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not load artifacts.");
  }
}

function titleForKind(kind: ArtifactEnvelope["kind"], payload: Record<string, unknown>): string {
  if (kind === "explanation") return "Explanation";
  if (kind === "mermaid") return "Diagram";
  if (kind === "image") return "Generated image";
  if (kind === "flashcards") return "Flashcards";
  if (kind === "assessment") return payload.mode === "quiz" ? "Quiz" : "Practice";
  return "Generated block";
}
