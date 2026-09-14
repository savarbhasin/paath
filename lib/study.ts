import { z } from "zod";

import { citationSchema } from "@/lib/tutor";

/** Flashcard review ratings. The intervals are fixed and deterministic. */
export const reviewRatingSchema = z.enum(["again", "hard", "good", "easy"]);
export type ReviewRating = z.infer<typeof reviewRatingSchema>;

export const REVIEW_RATING_LABEL: Record<ReviewRating, string> = {
  again: "Again",
  hard: "Hard",
  good: "Good",
  easy: "Easy",
};

/**
 * Fixed next-review intervals in milliseconds. Deliberately simple (no full
 * spaced-repetition algorithm — that is out of scope). Kept isolated and
 * deterministic so ticket 06 can reuse it for mastery input.
 */
export const REVIEW_INTERVAL_MS: Record<ReviewRating, number> = {
  again: 10 * 60 * 1000,
  hard: 24 * 60 * 60 * 1000,
  good: 3 * 24 * 60 * 60 * 1000,
  easy: 7 * 24 * 60 * 60 * 1000,
};

/** Deterministic: the same rating + instant always yields the same due date. */
export function nextReviewAt(rating: ReviewRating, now: Date): Date {
  return new Date(now.getTime() + REVIEW_INTERVAL_MS[rating]);
}

/** Validated payload for a flashcard deck artifact (pure kind payload). */
export const flashcardDeckPayloadSchema = z.object({
  cards: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        front: z.string().trim().min(1).max(1000),
        back: z.string().trim().min(1).max(2000),
        topicKey: z.string().trim().min(1).max(120),
      }),
    )
    .min(1)
    .max(20),
});

export type FlashcardDeckPayload = z.infer<typeof flashcardDeckPayloadSchema>;

export const assessmentModeSchema = z.enum(["practice", "quiz"]);
export type AssessmentMode = z.infer<typeof assessmentModeSchema>;

export const assessmentQuestionTypeSchema = z.enum(["single", "multi"]);
export type AssessmentQuestionType = z.infer<typeof assessmentQuestionTypeSchema>;

/** Validated payload for an assessment artifact (pure kind payload). */
export const assessmentPayloadSchema = z.object({
  mode: assessmentModeSchema,
  questions: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        type: assessmentQuestionTypeSchema,
        prompt: z.string().trim().min(1).max(2000),
        options: z
          .array(
            z.object({
              id: z.string().min(1).max(120),
              text: z.string().trim().min(1).max(1000),
            }),
          )
          .min(2)
          .max(6),
        correctOptionIds: z.array(z.string().min(1).max(120)).min(1).max(6),
        explanation: z.string().trim().min(1).max(2000),
        topicKey: z.string().trim().min(1).max(120),
        citations: z.array(citationSchema).default([]),
      }),
    )
    .min(1)
    .max(12),
});

export type AssessmentPayload = z.infer<typeof assessmentPayloadSchema>;

export type AssessmentQuestion = AssessmentPayload["questions"][number];

export const assessmentAnswersSchema = z.record(z.string(), z.array(z.string().max(120)).max(12));
export type AssessmentAnswers = z.infer<typeof assessmentAnswersSchema>;

export type QuestionResult = {
  questionId: string;
  type: AssessmentQuestionType;
  correct: boolean;
  expected: string[];
  received: string[];
  topicKey: string;
};

/**
 * Scores exact option sets in code — never by asking the model. Multi-select
 * requires an exact match: extra selected options earn no credit. Unknown
 * question ids are ignored; unanswered questions count as incorrect.
 */
export function scoreAssessment(
  questions: AssessmentQuestion[],
  answers: AssessmentAnswers,
): { results: QuestionResult[]; score: number } {
  const results = questions.map((question) => {
    const expected = [...new Set(question.correctOptionIds)].sort();
    const optionIds = new Set(question.options.map((option) => option.id));
    const received = [...new Set(answers[question.id] ?? [])]
      .filter((id) => optionIds.has(id))
      .sort();
    const correct = expected.length === received.length && expected.every((id, index) => received[index] === id);
    return {
      questionId: question.id,
      type: question.type,
      correct,
      expected,
      received,
      topicKey: question.topicKey,
    };
  });
  const score = results.length === 0 ? 0 : results.filter((result) => result.correct).length / results.length;
  return { results, score };
}

export const quizAttemptSchema = z.object({
  id: z.string().uuid(),
  artifact_id: z.string().uuid(),
  answers_json: assessmentAnswersSchema.default({}),
  results_json: z.unknown(),
  score: z.number().min(0).max(1),
  submitted_at: z.string(),
});

export type QuizAttemptResult = QuestionResult & {
  explanation: string;
  citations: AssessmentQuestion["citations"];
  prompt: string;
};

export type ScoredAttempt = {
  id: string;
  score: number;
  submittedAt: string;
  results: QuizAttemptResult[];
};
