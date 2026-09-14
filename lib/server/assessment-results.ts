import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type AssessmentAnswers,
  type AssessmentPayload,
  type QuizAttemptResult,
  assessmentPayloadSchema,
  scoreAssessment,
} from "@/lib/study";

export type AssessmentRow = {
  id: string;
  courseId: string;
  payload: AssessmentPayload;
};

export async function loadReadyAssessment(
  client: SupabaseClient,
  artifactId: string,
): Promise<AssessmentRow> {
  const { data, error } = await client
    .from("learning_artifacts")
    .select("id, course_id, kind, status, payload_json")
    .eq("id", artifactId)
    .single();
  if (error || !data) throw new Error("The assessment was not found.");
  const row = data as Record<string, unknown>;
  if (row.kind !== "assessment") throw new Error("This block is not an assessment.");
  if (row.status !== "ready") throw new Error("This assessment is not ready yet.");
  const parsed = assessmentPayloadSchema.safeParse(row.payload_json ?? {});
  if (!parsed.success) throw new Error("This assessment is malformed. Generate it again.");
  return { id: String(row.id), courseId: String(row.course_id), payload: parsed.data };
}

/**
 * Scores exact option sets in server code and attaches the stored
 * explanations, topic keys, and citations. The model never decides
 * correctness — only set equality does.
 */
export function scoreWithFeedback(
  payload: AssessmentPayload,
  answers: AssessmentAnswers,
): { results: QuizAttemptResult[]; score: number } {
  const { results, score } = scoreAssessment(payload.questions, answers);
  const byId = new Map(payload.questions.map((question) => [question.id, question]));
  return {
    results: results.map((result) => {
      const question = byId.get(result.questionId);
      return {
        ...result,
        prompt: question?.prompt ?? "",
        explanation: question?.explanation ?? "",
        citations: question?.citations ?? [],
      };
    }),
    score,
  };
}
