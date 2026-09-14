import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DEMO_WORKSPACE_ID } from "@/lib/config";
import type { Citation } from "@/lib/contracts";
import type { MemoryProvider } from "@/lib/providers/types";
import { listRecentMessages } from "@/lib/server/chat-repository";
import {
  formatLearnerStateForPrompt,
  listActiveMisconceptions,
  listTopicMastery,
  type MisconceptionView,
  type TopicMasteryView,
} from "@/lib/server/mastery";
import { retryPendingMemorySyncs } from "@/lib/server/learner-memory";
import { courseBelongsToWorkspace, listSourcesByCourse } from "@/lib/server/source-repository";
import type { ChatMessage } from "@/lib/tutor";

export type TutorSourceContext = {
  marker: string;
  sourceId: string;
  title: string;
  excerpt: string;
  locator?: Citation["locator"];
};

export type TutorContext = {
  course: { id: string; title: string };
  notebook: { id: string; title: string } | null;
  selectedText: string;
  recentMessages: ChatMessage[];
  sources: TutorSourceContext[];
  readySourceCount: number;
  profile: { static: string[]; dynamic: string[] };
  profileUsed: boolean;
  /** Active local misconceptions — visible even while the remote profile updates. */
  misconceptions: MisconceptionView[];
  /** Deterministic per-topic mastery for this course. */
  mastery: TopicMasteryView[];
  /** Compact learner-state block injected into tutor and generation prompts. */
  learnerState: string;
};

const MAX_EXCERPT_CHARS = 700;
const MAX_SOURCES = 6;

function truncate(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}...` : trimmed;
}

/**
 * Assembles everything the tutor prompt needs: the active course/notebook,
 * the current selection, recent thread history, ready-source search results
 * (course-filtered), the Supermemory learner profile when available, and the
 * local learner state (active misconceptions + deterministic topic mastery).
 * Profile and search failures degrade to empty context, never to an error.
 *
 * Ticket 06: pending memory syncs are retried first (idempotent by customId),
 * so a failed sync never blocks tutoring and never duplicates events.
 */
export async function assembleTutorContext(
  client: SupabaseClient,
  memory: MemoryProvider,
  input: {
    courseId: string;
    notebookId?: string | null;
    threadId?: string | null;
    question: string;
    selectedText?: string;
  },
): Promise<TutorContext> {
  const belongs = await courseBelongsToWorkspace(client, input.courseId, DEMO_WORKSPACE_ID);
  if (!belongs) {
    throw new Error("The course was not found.");
  }

  const { data: courseRow, error: courseError } = await client
    .from("courses")
    .select("id, title")
    .eq("id", input.courseId)
    .single();
  if (courseError) {
    throw new Error(`Could not load the course: ${courseError.message}`);
  }

  let notebook: TutorContext["notebook"] = null;
  if (input.notebookId) {
    const { data: notebookRow, error: notebookError } = await client
      .from("notebooks")
      .select("id, course_id, title")
      .eq("id", input.notebookId)
      .single();
    if (notebookError) {
      throw new Error(`Could not load the notebook: ${notebookError.message}`);
    }
    if (String((notebookRow as Record<string, unknown>).course_id) !== input.courseId) {
      throw new Error("The notebook does not belong to this course.");
    }
    notebook = { id: String((notebookRow as Record<string, unknown>).id), title: String((notebookRow as Record<string, unknown>).title) };
  }

  const selectedText = (input.selectedText ?? "").trim().slice(0, 2000);

  const recentMessages = input.threadId ? await listRecentMessages(client, input.threadId, 12) : [];

  // Flush pending/failed memory syncs before reading learner state. Each
  // retry reuses the event id as customId, so nothing duplicates.
  try {
    await retryPendingMemorySyncs(client, memory, input.courseId);
  } catch {
    // Sync failures never block tutoring; rows stay marked for next time.
  }

  const localSources = await listSourcesByCourse(client, input.courseId);
  const readySources = localSources.filter((source) => source.status === "ready");
  const localById = new Map(readySources.map((source) => [source.id, source]));

  let profile: TutorContext["profile"] = { static: [], dynamic: [] };
  try {
    profile = await memory.getProfile();
  } catch {
    profile = { static: [], dynamic: [] };
  }
  const profileUsed = profile.static.length + profile.dynamic.length > 0;

  let sources: TutorSourceContext[] = [];
  if (readySources.length > 0) {
    const retrievalQuery = selectedText ? `${input.question}\n\nSelected passage:\n${selectedText}` : input.question;
    try {
      const results = await memory.search({
        query: retrievalQuery,
        courseId: input.courseId,
        limit: MAX_SOURCES,
        allowedSourceIds: readySources.map((source) => source.id),
        // Hybrid here so learner-memory hits can inform tutoring; anything
        // that cannot be traced to a local source is dropped by the provider.
        searchMode: "hybrid",
      });
      sources = results.slice(0, MAX_SOURCES).flatMap((result, index) => {
        const local = localById.get(result.sourceId);
        if (!local) return [];
        return [
          {
            marker: `S${index + 1}`,
            sourceId: result.sourceId,
            title: local.title,
            excerpt: truncate(result.excerpt, MAX_EXCERPT_CHARS),
            locator: result.locator,
          },
        ];
      });
    } catch {
      sources = [];
    }
  }

  // Local learner state is read from Supabase, so a misconception recorded
  // seconds ago already shapes this answer — even while the remote profile
  // is still updating. Lookup failures degrade to empty state, never error.
  let misconceptions: MisconceptionView[] = [];
  let mastery: TopicMasteryView[] = [];
  try {
    misconceptions = await listActiveMisconceptions(client, input.courseId, 5);
  } catch {
    misconceptions = [];
  }
  try {
    mastery = await listTopicMastery(client, input.courseId);
  } catch {
    mastery = [];
  }
  const learnerState = formatLearnerStateForPrompt({ mastery, misconceptions });

  return {
    course: { id: String((courseRow as Record<string, unknown>).id), title: String((courseRow as Record<string, unknown>).title) },
    notebook,
    selectedText,
    recentMessages,
    sources,
    readySourceCount: readySources.length,
    profile: {
      static: profile.static.slice(0, 12),
      dynamic: profile.dynamic.slice(0, 12),
    },
    profileUsed,
    misconceptions,
    mastery,
    learnerState,
  };
}
