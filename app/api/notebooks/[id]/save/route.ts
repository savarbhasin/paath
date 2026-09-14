import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { apiError, readJson } from "@/lib/server/http";
import { saveNotebook } from "@/lib/server/notebook-repository";
import type { NotebookDocument } from "@/lib/domain";

const saveInput = z.object({
  contentJson: z.object({
    type: z.literal("doc"),
    content: z.array(z.unknown()).optional(),
  }),
  expectedVersion: z.number().int().positive(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) {
      return apiError("Notebook id is invalid.", 400);
    }

    const input = saveInput.parse(await readJson(request));
    const result = await saveNotebook(createSupabaseAdminClient(), {
      notebookId: id,
      contentJson: input.contentJson as NotebookDocument,
      expectedVersion: input.expectedVersion,
    });

    return NextResponse.json(result, { status: result.status === "conflict" ? 409 : 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError("Notebook content or version is invalid.", 400);
    }
    return apiError(error instanceof Error ? error.message : "Could not save notebook.");
  }
}
