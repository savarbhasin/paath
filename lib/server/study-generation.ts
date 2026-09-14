import "server-only";

import { z } from "zod";

import type { Citation } from "@/lib/contracts";
import type { ProviderError } from "@/lib/providers/types";
import { citationForResult } from "@/lib/providers/types";
import {
  buildCitationsForSourceIds,
  structuredChatCompletion,
} from "@/lib/server/generation";
import type { TutorSourceContext } from "@/lib/server/tutor-context";
import {
  type AssessmentMode,
  type AssessmentPayload,
  type FlashcardDeckPayload,
  assessmentModeSchema,
  assessmentPayloadSchema,
  flashcardDeckPayloadSchema,
} from "@/lib/study";

export type StudyContext = {
  courseTitle: string;
  topic: string;
  selectedText: string;
  sources: TutorSourceContext[];
  profile: { static: string[]; dynamic: string[] };
  /** Ticket 06 learner state (misconceptions + mastery) for content requests. */
  learnerState?: string;
};

function contextLines(context: StudyContext, sourceLines: string): string[] {
  return [
    `Course: ${context.courseTitle}`,
    `Topic: ${context.topic}`,
    context.selectedText ? `Selected passage:\n${context.selectedText}` : "Selected passage: none",
    context.learnerState ? `Learner state:\n${context.learnerState}` : "Learner state: no practice evidence yet.",
    `Retrieved course sources:\n${sourceLines}`,
  ];
}

/** Model-shaped deck: no ids yet — the server assigns them after validation. */
const deckModelSchema = z.object({
  cards: z
    .array(
      z.object({
        front: z.string().trim().min(1).max(1000),
        back: z.string().trim().min(1).max(2000),
        topicKey: z.string().trim().min(1).max(120),
      }),
    )
    .min(1)
    .max(12),
});

const deckJsonSchema = {
  name: "flashcard_deck",
  strict: true,
  schema: {
    type: "object",
    properties: {
      cards: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: {
          type: "object",
          properties: {
            front: { type: "string", description: "The question or prompt on the front of the card." },
            back: { type: "string", description: "The concise answer on the back of the card." },
            topicKey: {
              type: "string",
              description: "A short lowercase slug for the topic, e.g. photosynthesis-light.",
            },
          },
          required: ["front", "back", "topicKey"],
          additionalProperties: false,
        },
      },
    },
    required: ["cards"],
    additionalProperties: false,
  },
};

/**
 * Generates a validated flashcard deck with Structured Outputs. Retries once
 * on invalid output, then throws. Never returns an unvalidated payload, so
 * malformed model output creates no usable deck.
 */
export async function generateFlashcardDeck(
  context: StudyContext,
  sourceLines: string,
  count: number,
): Promise<{ payload: FlashcardDeckPayload; topicKeys: string[] }> {
  const system = [
    "You write concise flashcard decks for a course notebook.",
    "Base every card on the retrieved course sources. When the sources lack evidence, keep the deck small rather than inventing detail.",
    `Write ${count} cards. Each front is one focused question; each back is a short answer of one or two sentences.`,
    "Respond with the deck JSON object only.",
  ].join(" ");

  const content = await structuredChatCompletion({
    system,
    user: contextLines(context, sourceLines).join("\n\n"),
    jsonSchema: deckJsonSchema,
    emptyError: "The text model returned an empty flashcard deck.",
    malformedError: "The text model returned malformed JSON for the flashcard deck.",
  });

  let model: z.infer<typeof deckModelSchema>;
  try {
    model = deckModelSchema.parse(JSON.parse(content));
  } catch (error) {
    throw toStudyError(error, "The flashcard deck failed validation.");
  }

  const payload = flashcardDeckPayloadSchema.parse({
    cards: model.cards.map((card) => ({ ...card, id: crypto.randomUUID() })),
  });
  return { payload, topicKeys: [...new Set(payload.cards.map((card) => card.topicKey))] };
}

/** Model-shaped assessment: indexes + per-question source ids, no local ids. */
const assessmentModelSchema = z.object({
  questions: z
    .array(
      z.object({
        type: z.enum(["single", "multi"]),
        prompt: z.string().trim().min(1).max(2000),
        options: z.array(z.string().trim().min(1).max(1000)).min(2).max(6),
        correctOptionIndexes: z.array(z.number().int().min(0).max(5)).min(1).max(6),
        explanation: z.string().trim().min(1).max(2000),
        topicKey: z.string().trim().min(1).max(120),
        sourceIds: z.array(z.string()).max(6).default([]),
      }),
    )
    .min(1)
    .max(12),
});

const assessmentJsonSchema = {
  name: "assessment",
  strict: true,
  schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["single", "multi"],
              description: "single = one correct option; multi = two or more correct options.",
            },
            prompt: { type: "string", description: "The question text." },
            options: {
              type: "array",
              minItems: 2,
              maxItems: 6,
              items: { type: "string" },
              description: "Answer options in display order.",
            },
            correctOptionIndexes: {
              type: "array",
              minItems: 1,
              maxItems: 6,
              items: { type: "number" },
              description: "Zero-based indexes into options. Exactly one for single, two or more for multi.",
            },
            explanation: { type: "string", description: "One or two sentences saying why the correct set is right." },
            topicKey: {
              type: "string",
              description: "A short lowercase slug for the topic, e.g. photosynthesis-light.",
            },
            sourceIds: {
              type: "array",
              items: { type: "string" },
              description: "Ids of the retrieved sources this question is grounded in. Use ONLY the source ids listed.",
            },
          },
          required: ["type", "prompt", "options", "correctOptionIndexes", "explanation", "topicKey", "sourceIds"],
          additionalProperties: false,
        },
      },
    },
    required: ["questions"],
    additionalProperties: false,
  },
};

/**
 * Generates a validated assessment with Structured Outputs. The model writes
 * questions, options, explanations, and topic keys, but correctness is later
 * decided by exact set comparison in server code — never by the model.
 * Retries once on invalid output, then throws, so malformed output creates
 * no usable assessment.
 */
export async function generateAssessment(
  context: StudyContext,
  sourceLines: string,
  mode: AssessmentMode,
  count: number,
): Promise<{ payload: AssessmentPayload; topicKeys: string[] }> {
  const system = [
    "You write short grounded quizzes for a course notebook.",
    "Base every question on the retrieved course sources. When the sources lack evidence, keep the set small rather than inventing detail.",
    `Write ${count} questions. Include at least one single-choice and at least one multi-select question.`,
    "Single-choice questions have exactly one correct option. Multi-select questions have two or more correct options.",
    "Cite only the source ids listed below. Never invent a source id.",
    "Respond with the assessment JSON object only.",
  ].join(" ");

  const content = await structuredChatCompletion({
    system,
    user: contextLines(context, sourceLines).join("\n\n"),
    jsonSchema: assessmentJsonSchema,
    emptyError: "The text model returned an empty assessment.",
    malformedError: "The text model returned malformed JSON for the assessment.",
  });

  let model: z.infer<typeof assessmentModelSchema>;
  try {
    model = assessmentModelSchema.parse(JSON.parse(content));
  } catch (error) {
    throw toStudyError(error, "The assessment failed validation.");
  }

  const allowedSources = new Set(context.sources.map((source) => source.sourceId));
  const questions = model.questions.map((question) => {
    const indexes = [...new Set(question.correctOptionIndexes)].filter(
      (index) => index >= 0 && index < question.options.length,
    );
    if (question.type === "single" && indexes.length !== 1) {
      throw { code: "invalid_request", message: "A single-choice question must have exactly one correct option." } satisfies ProviderError;
    }
    if (question.type === "multi" && indexes.length < 2) {
      throw { code: "invalid_request", message: "A multi-select question must have at least two correct options." } satisfies ProviderError;
    }
    const options = question.options.map((text) => ({ id: crypto.randomUUID(), text }));
    // Drop unknown source ids before persistence — grounded questions link
    // only to retrieval-returned local sources.
    const validSourceIds = [...new Set(question.sourceIds)].filter((id) => allowedSources.has(id));
    const citations = buildCitationsForSourceIds(validSourceIds.slice(0, 4), context.sources);
    return {
      id: crypto.randomUUID(),
      type: question.type,
      prompt: question.prompt,
      options,
      correctOptionIds: indexes.map((index) => (options[index] as { id: string }).id),
      explanation: question.explanation,
      topicKey: question.topicKey,
      citations,
    };
  });

  if (questions.length >= 2) {
    const types = new Set(questions.map((question) => question.type));
    if (!types.has("single") || !types.has("multi")) {
      throw { code: "invalid_request", message: "The assessment must include a single-choice and a multi-select question." } satisfies ProviderError;
    }
  }

  const payload = assessmentPayloadSchema.parse({ mode, questions });
  return { payload, topicKeys: [...new Set(payload.questions.map((question) => question.topicKey))] };
}

export function assessmentModeFrom(value: unknown): AssessmentMode {
  return assessmentModeSchema.parse(value);
}

function toStudyError(error: unknown, fallback: string): ProviderError {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    return error as ProviderError;
  }
  return { code: "unknown", message: error instanceof Error ? `${fallback} ${error.message}` : fallback };
}

/** Builds envelope citations for a deck from retrieval-returned sources only. */
export function deckCitations(sourceIds: string[], sources: TutorSourceContext[]): Citation[] {
  return buildCitationsForSourceIds(sourceIds.slice(0, 4), sources);
}

export function citationFromRetrieval(
  sourceId: string,
  sources: TutorSourceContext[],
): Citation | null {
  const source = sources.find((entry) => entry.sourceId === sourceId);
  if (!source) return null;
  return citationForResult({
    sourceId: source.sourceId,
    providerDocumentId: null,
    courseId: null,
    title: source.title,
    excerpt: source.excerpt,
    similarity: null,
    locator: source.locator,
  });
}
