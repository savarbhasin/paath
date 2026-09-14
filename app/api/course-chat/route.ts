import { z } from "zod";

import { createSupermemoryMemoryProvider } from "@/lib/providers/memory";
import { toProviderError } from "@/lib/providers/types";
import {
  createMessage,
  createThread,
  getThread,
  listRecentMessages,
  touchThread,
} from "@/lib/server/chat-repository";
import { runCourseChatTurn, type CourseArtifactRef } from "@/lib/server/course-chat";
import { apiError, readJson } from "@/lib/server/http";
import { userFacingProviderMessage } from "@/lib/server/source-ingestion";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const courseChatInput = z.object({
  courseId: z.string().uuid(),
  threadId: z.string().uuid().nullable().optional(),
  question: z.string().trim().min(1).max(2000),
});

function encodeEvent(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Course-level study companion. Persists separate conversations per course
 * (`notebook_id` null — never a notebook tutor thread), runs the
 * server-side tool loop (max 5 calls), and streams the final answer as
 * server-sent events: `context`, `tool` (one per executed tool),
 * `delta`, then `done`. Citations resolve only against retrieved source
 * ids; unknown ids are rejected before persistence, like the tutor.
 */
export async function POST(request: Request) {
  let input: z.infer<typeof courseChatInput>;
  try {
    input = courseChatInput.parse(await readJson(request));
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
      if (!existing || existing.courseId !== input.courseId || existing.notebookId !== null) {
        return apiError("The course chat thread was not found.", 404);
      }
      thread = existing;
    } else {
      thread = await createThread(client, {
        courseId: input.courseId,
        notebookId: null,
        title: input.question.replace(/\s+/g, " ").slice(0, 60),
      });
    }

    await createMessage(client, {
      threadId: thread.id,
      role: "user",
      content: input.question,
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not start the course chat turn.");
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encodeEvent(event, data));
      try {
        send("thread", { threadId: thread.id });
        const recentMessages = await listRecentMessages(client, thread.id, 12);
        const artifacts: CourseArtifactRef[] = [];
        let studySessionId: string | null = null;

        const turn = await runCourseChatTurn({
          client,
          memory,
          courseId: input.courseId,
          question: input.question,
          recentMessages,
          onTool: (notice) => {
            if (notice.artifact) artifacts.push(notice.artifact);
            if (notice.sessionId) studySessionId = notice.sessionId;
            send("tool", {
              name: notice.name,
              summary: notice.summary,
              artifact: notice.artifact ?? null,
              sessionId: notice.sessionId ?? null,
            });
          },
          onDelta: (text) => {
            send("delta", { text });
          },
        });

        for (const artifact of turn.artifacts) {
          if (!artifacts.some((entry) => entry.id === artifact.id)) artifacts.push(artifact);
        }
        if (turn.studySessionId) studySessionId = turn.studySessionId;

        send("context", {
          threadId: thread.id,
          profileUsed: turn.profileUsed,
          readySources: turn.readySources,
        });

        const assistantMessage = await createMessage(client, {
          threadId: thread.id,
          role: "assistant",
          content: turn.text,
          citations: turn.citations,
          answerBasis: turn.answerBasis,
        });
        await touchThread(client, thread.id);

        send("done", {
          threadId: thread.id,
          messageId: assistantMessage.id,
          answerBasis: turn.answerBasis,
          citations: turn.citations,
          artifacts,
          studySessionId,
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
