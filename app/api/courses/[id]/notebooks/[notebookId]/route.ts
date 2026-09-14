import { NextResponse } from "next/server";
import { z } from "zod";

import { DEMO_WORKSPACE_ID } from "@/lib/config";
import type { Notebook, NotebookDocument } from "@/lib/domain";
import { apiError } from "@/lib/server/http";
import { courseBelongsToWorkspace } from "@/lib/server/source-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string; notebookId: string }> };

const uuid = z.string().uuid();

/**
 * Route-level notebook read. Validates server-side that the course belongs
 * to the workspace and the notebook belongs to that course, so a notebook
 * URL from one course can never render another course's content.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { id, notebookId } = await context.params;
  if (!uuid.safeParse(id).success || !uuid.safeParse(notebookId).success) {
    return apiError("Course or notebook id is invalid.", 400);
  }

  try {
    const client = createSupabaseAdminClient();
    const belongs = await courseBelongsToWorkspace(client, id, DEMO_WORKSPACE_ID);
    if (!belongs) return apiError("The course was not found.", 404);

    const { data, error } = await client
      .from("notebooks")
      .select("id, course_id, title, content_json, version, updated_at")
      .eq("id", notebookId)
      .eq("course_id", id)
      .maybeSingle();

    if (error) {
      throw new Error(`Could not load the notebook: ${error.message}`);
    }
    if (!data) return apiError("The notebook was not found in this course.", 404);

    const row = data as Record<string, unknown>;
    const notebook: Notebook = {
      id: String(row.id),
      courseId: String(row.course_id),
      title: String(row.title),
      contentJson: (row.content_json ?? { type: "doc", content: [{ type: "paragraph" }] }) as NotebookDocument,
      version: Number(row.version),
      updatedAt: String(row.updated_at),
    };
    return NextResponse.json({ notebook });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "The notebook could not be loaded.");
  }
}
