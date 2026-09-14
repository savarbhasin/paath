import { z } from "zod";

import { createSupermemoryMemoryProvider } from "@/lib/providers/memory";
import { toProviderError } from "@/lib/providers/types";
import { createMessage, getOrCreateThread, getThread, touchThread } from "@/lib/server/chat-repository";
import {
  buildCitationsForSourceIds,
  buildTutorMessages,
  extractCitedSourceIds,
  labelAnswerBasis,
  streamTutorCompletion,
} from "@/lib/server/generation";
import { apiError, readJson } from "@/lib/server/http";
import { userFacingProviderMessage } from "@/lib/server/source-ingestion";
import { assembleTutorContext } from "@/lib/server/tutor-context";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const tutorInput = z.object({
  courseId: z.string().uuid(),
  notebookId: z.string().uuid().nullable().optional(),
  threadId: z.string().uuid().nullable().optional(),
  question: z.string().trim().min(1).max(2000),
  selectedText: z.string().max(4000).nullable().optional(),
});

function encodeEvent(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Streams a grounded tutor answer as server-sent events:
 * `context` (thread + sources + profile flag), `delta` (text chunks),
 * then `done` (persisted message id, basis, verified citations).
 * Unknown citation ids are rejected before persistence, so stored answers
 * only ever link to retrieval-returned sources.
 */
export async function POST(request: Request) {
  let input: z.infer<typeof tutorInput>;
  try {
    input = tutorInput.parse(await readJson(request));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError("A valid course and question are required.", 400);
    }
    return apiError("Request body must be valid JSON.", 400);
  }

  const client = createSupabaseAdminClient();
  const memory = createSupermemoryMemoryProvider();

  let thread: { id: string; courseId: string; notebookId: string | null };
  try {
    if (input.threadId) {
      const existing = await getThread(client, input.threadId);
      if (!existing || existing.courseId !== input.courseId) {
        return apiError("The chat thread was not found.", 404);
      }
      thread = existing;
    } else {
      thread = await getOrCreateThread(client, {
        courseId: input.courseId,
        notebookId: input.notebookId ?? null,
        question: input.question,
      });
    }

    await createMessage(client, {
      threadId: thread.id,
      role: "user",
      content: input.question,
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not start the tutor turn.");
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encodeEvent(event, data));
      try {
        const context = await assembleTutorContext(client, memory, {
          courseId: input.courseId,
          notebookId: input.notebookId ?? thread.notebookId,
          threadId: thread.id,
          question: input.question,
          selectedText: input.selectedText ?? undefined,
        });

        send("context", {
          threadId: thread.id,
          profileUsed: context.profileUsed,
          readySources: context.readySourceCount,
          hasEvidence: context.sources.length > 0,
          sources: context.sources.map((source) => ({
            marker: source.marker,
            sourceId: source.sourceId,
            title: source.title,
            locator: source.locator ?? null,
          })),
        });

        const messages = buildTutorMessages(context, input.question);
        const fullText = await streamTutorCompletion(messages, (delta) => {
          send("delta", { text: delta });
        });

        // Citations are only valid for retrieval-returned source ids.
        const citedIds = extractCitedSourceIds(fullText, context.sources);
        const citations = buildCitationsForSourceIds(citedIds, context.sources);
        const answerBasis = labelAnswerBasis(fullText, citations);

        const assistantMessage = await createMessage(client, {
          threadId: thread.id,
          role: "assistant",
          content: fullText,
          citations,
          answerBasis,
        });
        await touchThread(client, thread.id);

        send("done", {
          threadId: thread.id,
          messageId: assistantMessage.id,
          answerBasis,
          citations,
        });
        controller.close();
      } catch (error) {
        const providerError = toProviderError(error);
        const code = providerError.code;
        const message =
          code === "invalid_request" || code === "rate_limited" || code === "unavailable" || code === "unknown"
            ? userFacingProviderMessage(code, providerError.message)
            : providerError.message;
        send("error", { message, providerCode: code });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
