import { NextResponse } from "next/server";
import { z } from "zod";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/config";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { apiError, readJson } from "@/lib/server/http";

const inputSchema = z.object({ id: z.string().uuid(), courseId: z.string().uuid(), kind: z.enum(["course", "notebook", "artifact"]), restore: z.boolean().optional() });

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await readJson(request));
    const client = createSupabaseAdminClient();
    const { data: workspace } = await client.from("workspaces").select("id").eq("id", DEMO_WORKSPACE_ID).eq("user_id", DEMO_USER_ID).maybeSingle();
    if (!workspace) return apiError("Workspace not found.", 404);
    const { data: course } = await client.from("courses").select("id").eq("id", input.courseId).eq("workspace_id", DEMO_WORKSPACE_ID).maybeSingle();
    if (!course) return apiError("Course not found.", 404);
    if (input.kind === "course") {
      if (input.id !== input.courseId) return apiError("Course id mismatch.", 400);
      const { error } = await client.from("courses").update({ archived_at: input.restore ? null : new Date().toISOString() }).eq("id", course.id);
      if (error) throw error;
    } else {
      const table = input.kind === "notebook" ? "notebooks" : "learning_artifacts";
      const { data: item } = await client.from(table).select("id").eq("id", input.id).eq("course_id", course.id).maybeSingle();
      if (!item) return apiError("Item not found.", 404);
      const result = input.kind === "notebook"
        ? await client.rpc("delete_notebook_with_artifacts", { target_id: input.id, target_course: course.id })
        : await client.from(table).delete().eq("id", input.id).eq("course_id", course.id);
      if (result.error) throw result.error;
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return apiError("Invalid item.", 400);
    return apiError(error instanceof Error ? error.message : "Could not update item.");
  }
}
