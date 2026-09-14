import { z } from "zod";

import type { Citation } from "@/lib/contracts";

/** How much of an answer is backed by retrieved course sources. */
export const answerBasisSchema = z.enum(["source", "mixed", "general_knowledge"]);
export type AnswerBasis = z.infer<typeof answerBasisSchema>;

export const ANSWER_BASIS_LABEL: Record<AnswerBasis, string> = {
  source: "Source-backed",
  mixed: "Mixed",
  general_knowledge: "General knowledge",
};

export type ChatRole = "user" | "assistant" | "system";

export type ChatThread = {
  id: string;
  courseId: string;
  notebookId: string | null;
  title: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  threadId: string;
  role: ChatRole;
  content: string;
  citations: Citation[];
  answerBasis: AnswerBasis | null;
};

export const citationSchema = z.object({
  sourceId: z.string().uuid(),
  title: z.string().min(1).max(200),
  excerpt: z.string().max(2000).optional(),
  marker: z.string().max(10).optional(),
  locator: z
    .object({
      kind: z.enum(["page", "timestamp", "section"]),
      value: z.string().min(1).max(200),
    })
    .optional(),
});

export const chatMessageSchema = z.object({
  id: z.string().uuid(),
  thread_id: z.string().uuid(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  citations_json: z.array(citationSchema).default([]),
  answer_basis: answerBasisSchema.nullable().default(null),
});

export function parseChatMessage(row: Record<string, unknown>): ChatMessage {
  const parsed = chatMessageSchema.parse({
    id: row.id,
    thread_id: row.thread_id,
    role: row.role,
    content: row.content,
    citations_json: Array.isArray(row.citations_json) ? row.citations_json : [],
    answer_basis: row.answer_basis ?? null,
  });
  return {
    id: parsed.id,
    threadId: parsed.thread_id,
    role: parsed.role,
    content: parsed.content,
    citations: parsed.citations_json,
    answerBasis: parsed.answer_basis,
  };
}

/** Validated payload for an explanation artifact (OpenAI Structured Outputs). */
export const explanationPayloadSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  sections: z
    .array(
      z.object({
        heading: z.string().trim().min(1).max(120),
        markdown: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(6),
  example: z.string().trim().max(2000).optional(),
});

export type ExplanationPayload = z.infer<typeof explanationPayloadSchema>;

/** Validated payload for a Mermaid diagram artifact (OpenAI Structured Outputs). */
export const mermaidPayloadSchema = z.object({
  code: z.string().trim().min(1).max(8000),
  caption: z.string().trim().min(1).max(500),
});

export type MermaidPayload = z.infer<typeof mermaidPayloadSchema>;

/** Validated payload for a generated-image artifact. Only the storage path is
 *  persisted — never a temporary provider URL. */
export const imagePayloadSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
  storagePath: z.string().trim().min(1).max(500),
  alt: z.string().trim().min(1).max(500),
  caption: z.string().trim().min(1).max(500),
});

export type ImagePayload = z.infer<typeof imagePayloadSchema>;

/** Planned image description from Structured Outputs, before bytes are made. */
export const imagePlanSchema = z.object({
  prompt: z.string().trim().min(10).max(2000),
  alt: z.string().trim().min(1).max(500),
  caption: z.string().trim().min(1).max(500),
});

export type ImagePlan = z.infer<typeof imagePlanSchema>;

/** Artifact lifecycle surfaced to the notebook. The database stores
 *  pending/generating/ready/failed; `retrying` is the transient client state
 *  while a retry request is in flight (the row reads `generating`). */
export const artifactStatusSchema = z.enum(["pending", "generating", "ready", "failed"]);
export type ArtifactStatus = z.infer<typeof artifactStatusSchema>;

/** Typed editor operations the browser may apply through Tiptap. */
export const editorOperationSchema = z.object({
  operation: z.enum(["append", "insert_after", "replace_selection"]),
  expectedNotebookVersion: z.number().int().positive(),
  anchorNodeId: z.string().max(120).optional(),
  replacementRange: z
    .object({
      from: z.number().int().nonnegative(),
      to: z.number().int().nonnegative(),
    })
    .optional(),
});

export type EditorOperationInput = z.infer<typeof editorOperationSchema>;

export type EditorOperation = EditorOperationInput & {
  artifactId: string;
};
