import { NextResponse } from "next/server";
import { z } from "zod";

import { createSupermemoryMemoryProvider } from "@/lib/providers/memory";
import { loadReadyAssessment, scoreWithFeedback } from "@/lib/server/assessment-results";
import { apiError, readJson } from "@/lib/server/http";
import {
  createLearningEvent,
  memorySyncSummary,
  recordAndSyncEvent,
} from "@/lib/server/learner-memory";
import {
  displayMasteryLabel,
  recordMisconception,
  refreshTopicMastery,
} from "@/lib/server/mastery";
import { assessmentAnswersSchema } from "@/lib/study";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };

const submitInput = z.object({
  answers: assessmentAnswersSchema,
});

/**
 * Scores the full option set with exact matching and persists the attempt:
 * answers, per-question results (with topic keys), explanations, citations,
 * and total score. The write must succeed before the submission counts, so
 * ticket 06 can trust every stored attempt row.
 *
 * Ticket 06 then derives learner state from the committed attempt: per-topic
 * mastery refreshes, wrong answers create or reinforce local misconceptions,
 * and learning events (per answer + completion + misconceptions) sync to
 * Supermemory. Memory sync failures never roll back the attempt.
 */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError("Artifact id is invalid.", 400);
  }

  let input: z.infer<typeof submitInput>;
  try {
    input = submitInput.parse(await readJson(request));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError("Answers must map question ids to selected option ids.", 400);
    }
    return apiError("Request body must be valid JSON.", 400);
  }

  try {
    const client = createSupabaseAdminClient();
    const assessment = await loadReadyAssessment(client, id);
    const { results, score } = scoreWithFeedback(assessment.payload, input.answers);

    const { data: attempt, error: attemptError } = await client
      .from("quiz_attempts")
      .insert({
        artifact_id: id,
        answers_json: input.answers,
        results_json: { results, score },
        score,
      })
      .select("id, score, submitted_at")
      .single();
    if (attemptError) {
      return apiError(`The submission could not be saved: ${attemptError.message}`);
    }

    const saved = attempt as Record<string, unknown>;

    // Ticket 06: app state (the attempt above) is committed first. Everything
    // below derives from it. Supabase derivation failures are reported as a
    // non-fatal warning — mastery recomputes deterministically from evidence,
    // so the next submit or review self-heals. Memory sync failures only mark
    // event rows failed; the attempt always stands.
    let learningWarning: string | null = null;
    let mastery: Array<{ topicKey: string; label: string; displayLabel: string; score: number; evidenceCount: number }> = [];
    const misconceptions: Array<{ id: string; topicKey: string; claim: string; evidenceCount: number; reinforced: boolean }> = [];
    let memory = { synced: 0, pending: 0, failed: 0, lastSyncedAt: null as string | null };
    try {
      const memoryProvider = createSupermemoryMemoryProvider();
      const courseId = assessment.courseId;
      const questionById = new Map(assessment.payload.questions.map((question) => [question.id, question]));

      // One audit event per graded answer. These rows stay queryable per
      // topic key as-is; they flush to Supermemory on the next retry pass
      // (profile, tutor, or generate request) so submit stays fast.
      for (const result of results) {
        await createLearningEvent(client, {
          courseId,
          kind: "quiz_answer",
          payload: {
            questionId: result.questionId,
            topicKey: result.topicKey,
            correct: result.correct,
            prompt: result.prompt.slice(0, 240),
            score,
          },
        });
      }

      // Wrong answers become visible local misconceptions immediately, even
      // while the remote profile is still updating.
      for (const result of results) {
        if (result.correct) continue;
        const question = questionById.get(result.questionId);
        const labelFor = (id: string) => question?.options.find((option) => option.id === id)?.text ?? "a removed option";
        const claim = `For "${result.prompt.slice(0, 200)}": chose ${result.received.map(labelFor).join("; ") || "nothing"} instead of ${result.expected.map(labelFor).join("; ")}`;
        const recorded = await recordMisconception(client, {
          courseId,
          topicKey: result.topicKey,
          claim,
          correction: result.explanation,
        });
        misconceptions.push({
          id: recorded.misconception.id,
          topicKey: recorded.misconception.topicKey,
          claim: recorded.misconception.claim,
          evidenceCount: recorded.misconception.evidenceCount,
          reinforced: recorded.reinforced,
        });
        // Misconceptions sync immediately — the next tutor request must see them.
        await recordAndSyncEvent(client, memoryProvider, {
          courseId,
          kind: "misconception",
          payload: {
            topicKey: result.topicKey,
            claim: recorded.misconception.claim.slice(0, 240),
            correction: recorded.misconception.correction.slice(0, 240),
            evidenceCount: recorded.misconception.evidenceCount,
          },
        });
      }

      // Completion summary syncs immediately; per-answer rows follow on retry.
      await recordAndSyncEvent(client, memoryProvider, {
        courseId,
        kind: "quiz_complete",
        payload: {
          artifactId: id,
          mode: assessment.payload.mode,
          score,
          total: results.length,
          correct: results.filter((result) => result.correct).length,
        },
      });

      // Only topics with new evidence are touched.
      const refreshed = await refreshTopicMastery(
        client,
        courseId,
        results.map((result) => result.topicKey),
      );
      mastery = refreshed.map((entry) => ({
        topicKey: entry.topicKey,
        label: entry.label,
        displayLabel: displayMasteryLabel(entry),
        score: entry.score,
        evidenceCount: entry.evidenceCount,
      }));
      memory = await memorySyncSummary(client, courseId);
    } catch (error) {
      learningWarning = error instanceof Error ? error.message : "Learner memory could not be updated.";
    }

    return NextResponse.json(
      {
        attempt: {
          id: String(saved.id),
          score: Number(saved.score),
          submittedAt: String(saved.submitted_at),
          results,
        },
        mastery,
        misconceptions,
        memory,
        ...(learningWarning ? { learningWarning } : {}),
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "The submission could not be saved.";
    const status = /not found/i.test(message) ? 404 : /malformed/i.test(message) ? 422 : 500;
    return apiError(message, status);
  }
}
