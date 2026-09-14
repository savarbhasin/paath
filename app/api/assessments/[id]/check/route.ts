import { NextResponse } from "next/server";
import { z } from "zod";

import { loadReadyAssessment, scoreWithFeedback } from "@/lib/server/assessment-results";
import { apiError, readJson } from "@/lib/server/http";
import { assessmentAnswersSchema } from "@/lib/study";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

const checkInput = z.object({
  answers: assessmentAnswersSchema,
});

/**
 * Scores a submitted option set without persisting. Practice mode uses this
 * for immediate per-question feedback; the quiz submit route persists.
 * Correctness comes only from exact set comparison in server code.
 */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError("Artifact id is invalid.", 400);
  }

  let input: z.infer<typeof checkInput>;
  try {
    input = checkInput.parse(await readJson(request));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError("Answers must map question ids to selected option ids.", 400);
    }
    return apiError("Request body must be valid JSON.", 400);
  }

  try {
    const client = createSupabaseAdminClient();
    const assessment = await loadReadyAssessment(client, id);
    // Score only the answered subset so practice feedback stays per question.
    const answeredIds = new Set(Object.keys(input.answers));
    const subset = assessment.payload.questions.filter((question) => answeredIds.has(question.id));
    if (subset.length === 0) return apiError("Answer at least one question first.", 400);
    const { results } = scoreWithFeedback({ ...assessment.payload, questions: subset }, input.answers);
    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The answer could not be checked.";
    const status = /not found/i.test(message) ? 404 : /malformed/i.test(message) ? 422 : 500;
    return apiError(message, status);
  }
}
