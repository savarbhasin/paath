import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Citation } from "@/lib/contracts";
import { type AnswerBasis, type ChatMessage, type ChatThread, parseChatMessage } from "@/lib/tutor";

type Row = Record<string, unknown>;

function asThread(row: Row): ChatThread {
  return {
    id: String(row.id),
    courseId: String(row.course_id),
    notebookId: row.notebook_id == null ? null : String(row.notebook_id),
    title: String(row.title),
    updatedAt: String(row.updated_at),
  };
}

const THREAD_COLUMNS = "id, course_id, notebook_id, title, updated_at";
const MESSAGE_COLUMNS = "id, thread_id, role, content, citations_json, answer_basis";

function threadTitleFor(question: string): string {
  const trimmed = question.trim().replace(/\s+/g, " ");
  if (!trimmed) return "Notebook chat";
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}...` : trimmed;
}

export async function listThreads(
  client: SupabaseClient,
  input: { courseId: string; notebookId?: string | null },
): Promise<ChatThread[]> {
  let query = client
    .from("chat_threads")
    .select(THREAD_COLUMNS)
    .eq("course_id", input.courseId)
    .order("updated_at", { ascending: false })
    .limit(20);

  if (input.notebookId) {
    query = query.eq("notebook_id", input.notebookId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Could not list chat threads: ${error.message}`);
  }
  return (data ?? []).map((row) => asThread(row as Row));
}

export async function getThread(client: SupabaseClient, threadId: string): Promise<ChatThread | null> {
  const { data, error } = await client.from("chat_threads").select(THREAD_COLUMNS).eq("id", threadId).maybeSingle();
  if (error) {
    throw new Error(`Could not load the chat thread: ${error.message}`);
  }
  return data ? asThread(data as Row) : null;
}

/**
 * Always creates a fresh thread (unlike getOrCreateThread, which resumes the
 * most recent one). Used by explicit "New chat" actions.
 */
export async function createThread(
  client: SupabaseClient,
  input: { courseId: string; notebookId?: string | null; title?: string },
): Promise<ChatThread> {
  const { data, error } = await client
    .from("chat_threads")
    .insert({
      course_id: input.courseId,
      notebook_id: input.notebookId ?? null,
      title: (input.title ?? "").trim() || "New chat",
    })
    .select(THREAD_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Could not start the chat thread: ${error.message}`);
  }
  return asThread(data as Row);
}

/**
 * Returns the most recent thread for a course/notebook pair, creating one
 * when none exists. Threads are the persistence boundary for tutor history.
 */
export async function getOrCreateThread(
  client: SupabaseClient,
  input: { courseId: string; notebookId?: string | null; question: string },
): Promise<ChatThread> {
  let query = client
    .from("chat_threads")
    .select(THREAD_COLUMNS)
    .eq("course_id", input.courseId)
    .order("updated_at", { ascending: false })
    .limit(1);

  query = input.notebookId ? query.eq("notebook_id", input.notebookId) : query.is("notebook_id", null);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Could not load the chat thread: ${error.message}`);
  }
  if (data && data.length > 0) {
    return asThread(data[0] as Row);
  }

  const { data: created, error: createError } = await client
    .from("chat_threads")
    .insert({
      course_id: input.courseId,
      notebook_id: input.notebookId ?? null,
      title: threadTitleFor(input.question),
    })
    .select(THREAD_COLUMNS)
    .single();

  if (createError) {
    throw new Error(`Could not start the chat thread: ${createError.message}`);
  }
  return asThread(created as Row);
}

export async function touchThread(client: SupabaseClient, threadId: string): Promise<void> {
  const { error } = await client.from("chat_threads").update({ updated_at: new Date().toISOString() }).eq("id", threadId);
  if (error) {
    throw new Error(`Could not update the chat thread: ${error.message}`);
  }
}

export async function listRecentMessages(
  client: SupabaseClient,
  threadId: string,
  limit = 12,
): Promise<ChatMessage[]> {
  const { data, error } = await client
    .from("chat_messages")
    .select(MESSAGE_COLUMNS)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 30));

  if (error) {
    throw new Error(`Could not load chat history: ${error.message}`);
  }
  const messages = (data ?? []).map((row) => parseChatMessage(row as Row));
  return messages.reverse();
}

export async function createMessage(
  client: SupabaseClient,
  input: { threadId: string; role: "user" | "assistant"; content: string; citations?: Citation[]; answerBasis?: AnswerBasis },
): Promise<ChatMessage> {
  const { data, error } = await client
    .from("chat_messages")
    .insert({
      thread_id: input.threadId,
      role: input.role,
      content: input.content,
      citations_json: input.citations ?? [],
      answer_basis: input.answerBasis ?? "general_knowledge",
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Could not save the chat message: ${error.message}`);
  }
  return parseChatMessage(data as Row);
}

/** Paginated course conversation history, oldest messages first. */
export async function listCourseMessages(client: SupabaseClient, threadId: string, offset: number) {
  const { data, error } = await client.from("chat_messages").select(MESSAGE_COLUMNS)
    .eq("thread_id", threadId).order("created_at", { ascending: true }).order("id", { ascending: true })
    .range(offset, offset + 49);
  if (error) throw new Error(`Could not load chat history: ${error.message}`);
  return (data ?? []).map((row) => parseChatMessage(row as Row));
}
