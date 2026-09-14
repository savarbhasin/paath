import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { apiError, readJson } from "@/lib/server/http";
import { createNotebook } from "@/lib/server/notebook-repository";

const notebookInput = z.object({
  courseId: z.string().uuid(),
  title: z.string().trim().min(1).max(100),
});

export async function POST(request: Request) {
  try {
    const input = notebookInput.parse(await readJson(request));
    const notebook = await createNotebook(createSupabaseAdminClient(), input);
    return NextResponse.json(notebook, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError("A valid course and notebook title are required.", 400);
    }
    return apiError(error instanceof Error ? error.message : "Could not create notebook.");
  }
}
