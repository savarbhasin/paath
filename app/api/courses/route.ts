import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { apiError, readJson } from "@/lib/server/http";
import { createCourse } from "@/lib/server/notebook-repository";

const courseInput = z.object({
  title: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#2d6a4f"),
});

export async function POST(request: Request) {
  try {
    const input = courseInput.parse(await readJson(request));
    const course = await createCourse(createSupabaseAdminClient(), input);
    return NextResponse.json(course, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError("Course title and color are invalid.", 400);
    }
    return apiError(error instanceof Error ? error.message : "Could not create course.");
  }
}
