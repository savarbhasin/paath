import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { DEMO_WORKSPACE_ID } from "@/lib/config";
import type { Citation } from "@/lib/contracts";
import type { MemoryProvider, ProviderError } from "@/lib/providers/types";
import { getFireworksServerConfig } from "@/lib/providers/server-clients";
import { listRecentLearningEvents } from "@/lib/server/learner-memory";
import {
  displayMasteryLabel,
  formatLearnerStateForPrompt,
  listActiveMisconceptions,
  listTopicMastery,
} from "@/lib/server/mastery";
import { courseBelongsToWorkspace, listSourcesByCourse } from "@/lib/server/source-repository";
import { generateAssessment, generateFlashcardDeck } from "@/lib/server/study-generation";
import { enqueueVideo } from "@/lib/server/video-jobs";
import { createStudySession } from "@/lib/server/study-sessions";
import { buildCitationsForSourceIds, extractCitedSourceIds, labelAnswerBasis } from "@/lib/server/generation";
import { gatherVisualContext, type VisualContext } from "@/lib/server/visual-generation";
import type { AnswerBasis, ChatMessage } from "@/lib/tutor";

/**
 * Course-level study companion (ticket 08). A server-side function-
 * calling loop — at most MAX_TOOL_CALLS executions per turn — over the
 * existing course-scoped server code. No new retrieval system, no raw
 * notebook writes, no memory add/forget, no web browsing.
 *
 * READ tools expose existing queries; WRITE tools run the same validated
 * generation pipeline as /api/generate (Structured Outputs + unknown source
 * ids dropped) but persist course-level rows (`notebook_id` is null, which
 * the foundation migration already allows).
 */

export const MAX_TOOL_CALLS = 5;

const TEXT_CHAT_URL = "https://api.fireworks.ai/inference/v1/chat/completions";

export type CourseArtifactRef = {
  id: string;
  kind: "assessment" | "flashcards" | "video";
  title: string;
  url: string;
};

export type CourseChatNotice = {
  name: string;
  summary: string;
  artifact?: CourseArtifactRef;
  sessionId?: string;
};

type RegistryEntry = {
  marker: string;
  sourceId: string;
  title: string;
  excerpt: string;
  locator?: Citation["locator"];
};

type ChatWireMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
};

const toolFunction = (name: string, description: string, parameters: Record<string, unknown>) => ({
  type: "function" as const,
  function: { name, description, parameters },
});

export const COURSE_CHAT_TOOLS = [
  toolFunction("create_video", "Create a narrated teaching video explaining a topic. Returns a saved link immediately; rendering continues in the background. Never claim the video is ready when it is queued.", {
    type: "object", properties: { topic: { type: "string", description: "Concept to teach." }, sourceIds: { type: "array", items: { type: "string" }, description: "Optional course source IDs to use." } }, required: ["topic"], additionalProperties: false,
  }),
  toolFunction("search_sources", "Search ready course sources for grounding passages. Returns marker-tagged excerpts; cite with [S1]-style markers only.", {
    type: "object",
    properties: {
      query: { type: "string", description: "What to look for in the course material." },
      limit: { type: "number", description: "How many passages to return (1-6)." },
    },
    required: ["query"],
    additionalProperties: false,
  }),
  toolFunction("list_notebooks", "List the notebooks in this course (ids + titles) for cross-notebook connections.", {
    type: "object",
    properties: {},
    additionalProperties: false,
  }),
  toolFunction("read_notebook", "Read a notebook's plain text (this course only) to connect ideas across notebooks.", {
    type: "object",
    properties: {
      notebookId: { type: "string", description: "A notebook id from list_notebooks." },
      maxChars: { type: "number", description: "Max characters to return (500-6000)." },
    },
    required: ["notebookId"],
    additionalProperties: false,
  }),
  toolFunction("get_mastery", "Per-topic mastery for this course with display labels (weak spots first).", {
    type: "object",
    properties: {},
    additionalProperties: false,
  }),
  toolFunction("get_misconceptions", "Active misconceptions recorded from wrong answers in this course.", {
    type: "object",
    properties: {
      limit: { type: "number", description: "How many to return (1-10)." },
    },
    additionalProperties: false,
  }),
  toolFunction("get_recent_activity", "Recent learning events and quiz attempts in this course.", {
    type: "object",
    properties: {
      limit: { type: "number", description: "How many events to return (1-15)." },
    },
    additionalProperties: false,
  }),
  toolFunction("get_learner_profile", "Supermemory learner profile (static + recent facts). Best-effort; may be empty.", {
    type: "object",
    properties: {},
    additionalProperties: false,
  }),
  toolFunction(
    "generate_quiz",
    "Generate a grounded quiz or practice set as a course-level artifact. Use for 'quiz me on X'. The artifact opens from the sidebar; it is never inserted into a notebook.",
    {
      type: "object",
      properties: {
        topic: { type: "string", description: "The topic to quiz, e.g. photosynthesis-light." },
        count: { type: "number", description: "Questions to write (1-8)." },
        mode: { type: "string", enum: ["quiz", "practice"], description: "quiz reveals feedback after submit; practice checks per question." },
        sourceIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional source ids to scope grounding to (e.g. 'from chapter 3'). Unknown ids are dropped.",
        },
      },
      required: ["topic"],
      additionalProperties: false,
    },
  ),
  toolFunction(
    "generate_flashcards",
    "Generate a grounded flashcard deck as a course-level artifact. The deck opens from the sidebar; it is never inserted into a notebook.",
    {
      type: "object",
      properties: {
        topic: { type: "string", description: "The topic for the deck." },
        count: { type: "number", description: "Cards to write (1-8)." },
        sourceIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional source ids to scope grounding to. Unknown ids are dropped.",
        },
      },
      required: ["topic"],
      additionalProperties: false,
    },
  ),
  toolFunction("start_study_session", "Start (or resume) the fixed recap → flashcards → practice → result study session, seeded from weak areas.", {
    type: "object",
    properties: {},
    additionalProperties: false,
  }),
];

type ToolContext = {
  client: SupabaseClient;
  memory: MemoryProvider;
  courseId: string;
  courseTitle: string;
  registry: Map<string, RegistryEntry>;
  readyById: Map<string, { id: string; title: string }>;
  profileUsed: boolean;
  requestKey: string;
};

function truncate(text: string, limit: number): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}...` : trimmed;
}

function parseArgs(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function studySourceLines(retrieval: VisualContext["retrieval"]): string {
  if (retrieval.length === 0) {
    return "No source passages were retrieved. There is no course evidence for this topic.";
  }
  const passages = retrieval.map((source) => `[${source.sourceId}] ${source.title}\n${source.excerpt}`).join("\n\n");
  return `${passages}\n\nUsable source ids (cite only these): ${retrieval.map((source) => source.sourceId).join(", ")}`;
}

function plainTextFromDoc(doc: unknown, limit: number): { text: string; truncated: boolean } {
  const parts: string[] = [];
  let size = 0;
  let truncated = false;
  const visit = (node: unknown): boolean => {
    if (size >= limit) {
      truncated = true;
      return false;
    }
    if (typeof node !== "object" || node === null) return true;
    const record = node as Record<string, unknown>;
    if (typeof record.text === "string" && record.text) {
      parts.push(record.text);
      size += record.text.length;
    }
    if (Array.isArray(record.content)) {
      for (const child of record.content) {
        if (!visit(child)) return false;
      }
      if (record.type === "paragraph" || typeof record.type === "string") parts.push("\n");
    }
    return true;
  };
  visit(doc);
  const text = parts.join("").replace(/\n{3,}/g, "\n\n").trim().slice(0, limit);
  return { text, truncated: truncated || text.length >= limit };
}

async function textChatFetch(apiKey: string, body: Record<string, unknown>): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(TEXT_CHAT_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw {
      code: "unavailable",
      message: error instanceof Error ? `The text model is unreachable: ${error.message}` : "The text model is unreachable.",
    } satisfies ProviderError;
  }
  if (!response.ok) {
    let detail: string | null = null;
    try {
      const payload = (await response.json()) as Record<string, unknown>;
      const errorBlock = payload.error as Record<string, unknown> | undefined;
      detail = typeof errorBlock?.message === "string" ? (errorBlock.message as string) : null;
    } catch {
      detail = null;
    }
    const code = response.status === 429 ? "rate_limited" : response.status >= 500 ? "unavailable" : "invalid_request";
    throw { code, message: detail ?? `The text model returned status ${response.status}.` } satisfies ProviderError;
  }
  return response;
}

type ToolOutcome = { summary: string; result: Record<string, unknown>; notice: CourseChatNotice };

async function executeTool(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const fail = (summary: string, message: string): ToolOutcome => ({
    summary,
    result: { ok: false, error: message },
    notice: { name, summary: `${summary}: ${message}` },
  });

  switch (name) {
    case "create_video": {
      const topic = typeof args.topic === "string" ? args.topic.trim().slice(0, 200) : "";
      if (!topic) return fail("Video creation failed", "A topic is required.");
      try {
        const context = await gatherVisualContext(ctx.client, ctx.courseId, topic, "");
        const requested = Array.isArray(args.sourceIds) ? new Set(args.sourceIds.filter((id): id is string => typeof id === "string")) : null;
        const retrieval = requested ? context.retrieval.filter((entry) => requested.has(entry.sourceId)) : context.retrieval;
        const sourceIds = [...new Set(retrieval.map((entry) => entry.sourceId))];
        const artifact = await enqueueVideo(ctx.client, {
          courseId: ctx.courseId, topic, requestKey: ctx.requestKey,
          context: { courseTitle: context.courseTitle, learnerState: context.learnerState, retrieval, sourceIds, citations: context.citations.filter((citation) => sourceIds.includes(citation.sourceId)) },
        });
        return { summary: `Queued video: ${topic}`, result: { ok: true, artifact, status: "queued", note: "The local worker creates the video in the background. Open the link for progress." }, notice: { name, summary: `Creating video: ${topic}`, artifact } };
      } catch (error) {
        return fail("Video creation failed", error instanceof Error ? error.message : "The video could not be queued.");
      }
    }

    case "search_sources": {
      const query = typeof args.query === "string" ? args.query.trim().slice(0, 500) : "";
      if (!query) return fail("Source search failed", "A search query is required.");
      const limit = asNumber(args.limit, 4, 1, 6);
      const readyIds = [...ctx.readyById.keys()];
      if (readyIds.length === 0) {
        return {
          summary: "No ready sources to search yet",
          result: { ok: true, results: [], note: "No course sources are ready yet." },
          notice: { name, summary: "No ready sources to search yet" },
        };
      }
      let results: Awaited<ReturnType<MemoryProvider["search"]>>;
      try {
        results = await ctx.memory.search({
          query,
          courseId: ctx.courseId,
          limit,
          allowedSourceIds: readyIds,
          searchMode: "documents",
        });
      } catch (error) {
        return fail("Source search failed", error instanceof Error ? error.message : "The search provider is unreachable.");
      }
      const entries = results.slice(0, limit).flatMap((entry) => {
        const local = ctx.readyById.get(entry.sourceId);
        if (!local) return [];
        let registered = ctx.registry.get(entry.sourceId);
        if (!registered) {
          registered = {
            marker: `S${ctx.registry.size + 1}`,
            sourceId: entry.sourceId,
            title: local.title,
            excerpt: truncate(entry.excerpt, 500),
            locator: entry.locator,
          };
          ctx.registry.set(entry.sourceId, registered);
        }
        return [
          {
            marker: registered.marker,
            sourceId: registered.sourceId,
            title: registered.title,
            excerpt: registered.excerpt,
            locator: registered.locator ?? null,
          },
        ];
      });
      return {
        summary: `Searched sources (${entries.length} passage${entries.length === 1 ? "" : "s"})`,
        result: { ok: true, results: entries },
        notice: { name, summary: `Searched sources (${entries.length} passage${entries.length === 1 ? "" : "s"})` },
      };
    }

    case "list_notebooks": {
      const { data, error } = await ctx.client
        .from("notebooks")
        .select("id, title, updated_at")
        .eq("course_id", ctx.courseId)
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) return fail("Notebook list failed", error.message);
      const notebooks = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        notebookId: String(row.id),
        title: String(row.title),
      }));
      return {
        summary: `Listed ${notebooks.length} notebook${notebooks.length === 1 ? "" : "s"}`,
        result: { ok: true, notebooks },
        notice: { name, summary: `Listed ${notebooks.length} notebook${notebooks.length === 1 ? "" : "s"}` },
      };
    }

    case "read_notebook": {
      const notebookId = typeof args.notebookId === "string" ? args.notebookId : "";
      if (!z.string().uuid().safeParse(notebookId).success) {
        return fail("Notebook read failed", "A valid notebook id from list_notebooks is required.");
      }
      const { data, error } = await ctx.client
        .from("notebooks")
        .select("id, course_id, title, content_json")
        .eq("id", notebookId)
        .maybeSingle();
      if (error || !data) return fail("Notebook read failed", "The notebook was not found.");
      const row = data as Record<string, unknown>;
      if (String(row.course_id) !== ctx.courseId) {
        return fail("Notebook read failed", "That notebook is not in this course.");
      }
      const maxChars = asNumber(args.maxChars, 3000, 500, 6000);
      const { text, truncated } = plainTextFromDoc(row.content_json, maxChars);
      return {
        summary: `Read notebook "${String(row.title).slice(0, 60)}"`,
        result: { ok: true, title: String(row.title), text, truncated },
        notice: { name, summary: `Read notebook "${String(row.title).slice(0, 60)}"` },
      };
    }

    case "get_mastery": {
      const mastery = await listTopicMastery(ctx.client, ctx.courseId);
      return {
        summary: mastery.length === 0 ? "No practice evidence yet" : `Mastery for ${mastery.length} topic${mastery.length === 1 ? "" : "s"}`,
        result: {
          ok: true,
          mastery: mastery.map((entry) => ({
            topicKey: entry.topicKey,
            score: entry.score,
            evidenceCount: entry.evidenceCount,
            displayLabel: displayMasteryLabel(entry),
          })),
        },
        notice: {
          name,
          summary: mastery.length === 0 ? "No practice evidence yet" : `Checked mastery (${mastery.length} topics)`,
        },
      };
    }

    case "get_misconceptions": {
      const limit = asNumber(args.limit, 5, 1, 10);
      const items = await listActiveMisconceptions(ctx.client, ctx.courseId, limit);
      return {
        summary: items.length === 0 ? "No active misconceptions" : `${items.length} active misconception${items.length === 1 ? "" : "s"}`,
        result: {
          ok: true,
          misconceptions: items.map((entry) => ({
            topicKey: entry.topicKey,
            claim: entry.claim,
            correction: entry.correction,
            evidenceCount: entry.evidenceCount,
          })),
        },
        notice: { name, summary: items.length === 0 ? "No active misconceptions" : `Checked ${items.length} misconception${items.length === 1 ? "" : "s"}` },
      };
    }

    case "get_recent_activity": {
      const limit = asNumber(args.limit, 10, 1, 15);
      const events = await listRecentLearningEvents(ctx.client, ctx.courseId, limit);
      const { data: artifactRows } = await ctx.client
        .from("learning_artifacts")
        .select("id")
        .eq("course_id", ctx.courseId)
        .eq("kind", "assessment");
      const artifactIds = ((artifactRows ?? []) as Record<string, unknown>[]).map((row) => String(row.id));
      let attempts: Array<Record<string, unknown>> = [];
      if (artifactIds.length > 0) {
        const { data } = await ctx.client
          .from("quiz_attempts")
          .select("artifact_id, score, submitted_at")
          .in("artifact_id", artifactIds)
          .order("submitted_at", { ascending: false })
          .limit(5);
        attempts = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
          artifactId: String(row.artifact_id),
          score: Number(row.score),
          submittedAt: String(row.submitted_at),
        }));
      }
      return {
        summary: `${events.length} recent event${events.length === 1 ? "" : "s"}, ${attempts.length} recent attempt${attempts.length === 1 ? "" : "s"}`,
        result: {
          ok: true,
          events: events.map((event) => ({ kind: event.kind, payload: event.payload, createdAt: event.createdAt })),
          attempts,
        },
        notice: { name, summary: `Checked recent activity (${events.length} events)` },
      };
    }

    case "get_learner_profile": {
      let profile = { static: [] as string[], dynamic: [] as string[] };
      try {
        profile = await ctx.memory.getProfile();
      } catch {
        profile = { static: [], dynamic: [] };
      }
      const summary =
        profile.static.length + profile.dynamic.length > 0
          ? `Learner profile (${profile.static.length + profile.dynamic.length} facts)`
          : "No learner profile yet";
      return {
        summary,
        result: { ok: true, static: profile.static.slice(0, 12), dynamic: profile.dynamic.slice(0, 12) },
        notice: { name, summary },
      };
    }

    case "generate_quiz":
    case "generate_flashcards": {
      const isQuiz = name === "generate_quiz";
      const topic = typeof args.topic === "string" ? args.topic.trim().slice(0, 200) : "";
      if (!topic) return fail(isQuiz ? "Quiz generation failed" : "Flashcard generation failed", "A topic is required.");
      const count = asNumber(args.count, isQuiz ? 4 : 6, 1, 8);
      const mode = args.mode === "practice" ? "practice" : "quiz";
      const requestedIds = Array.isArray(args.sourceIds)
        ? [...new Set(args.sourceIds.filter((id): id is string => typeof id === "string"))]
        : null;

      let context: VisualContext;
      try {
        context = await gatherVisualContext(ctx.client, ctx.courseId, topic, "");
      } catch (error) {
        return fail(isQuiz ? "Quiz generation failed" : "Flashcard generation failed", error instanceof Error ? error.message : "Course context could not be loaded.");
      }
      // Scope to requested sources when given; unknown ids are dropped
      // before generation so grounding stays retrieval-traced.
      let retrieval = context.retrieval;
      if (requestedIds) {
        const allowed = new Set(requestedIds.filter((id) => context.retrieval.some((entry) => entry.sourceId === id)));
        if (allowed.size > 0) retrieval = retrieval.filter((entry) => allowed.has(entry.sourceId));
      }
      const sourceIds = [...new Set(retrieval.map((entry) => entry.sourceId))].slice(0, 6);

      try {
        if (isQuiz) {
          const assessment = await generateAssessment(
            {
              courseTitle: context.courseTitle,
              topic,
              selectedText: "",
              sources: retrieval,
              profile: context.profile,
              learnerState: context.learnerState,
            },
            studySourceLines(retrieval),
            mode,
            count,
          );
          const { data, error } = await ctx.client
            .from("learning_artifacts")
            .insert({
              course_id: ctx.courseId,
              notebook_id: null,
              kind: "assessment",
              status: "ready",
              payload_json: assessment.payload,
              source_ids: sourceIds,
              error: null,
            })
            .select("id")
            .single();
          if (error) throw new Error(`The quiz could not be saved: ${error.message}`);
          const artifactId = String((data as Record<string, unknown>).id);
          const title = `${mode === "quiz" ? "Quiz" : "Practice"} · ${topic.slice(0, 60)}`;
          const artifact: CourseArtifactRef = {
            id: artifactId,
            kind: "assessment",
            title,
            url: `/courses/${ctx.courseId}/study/${artifactId}`,
          };
          return {
            summary: `Generated ${title} (${assessment.payload.questions.length} questions)`,
            result: { ok: true, artifact, questionCount: assessment.payload.questions.length, topicKeys: assessment.topicKeys },
            notice: { name, summary: `Generated ${title}`, artifact },
          };
        }
        const deck = await generateFlashcardDeck(
          {
            courseTitle: context.courseTitle,
            topic,
            selectedText: "",
            sources: retrieval,
            profile: context.profile,
            learnerState: context.learnerState,
          },
          studySourceLines(retrieval),
          count,
        );
        const { data, error } = await ctx.client
          .from("learning_artifacts")
          .insert({
            course_id: ctx.courseId,
            notebook_id: null,
            kind: "flashcards",
            status: "ready",
            payload_json: deck.payload,
            source_ids: sourceIds,
            error: null,
          })
          .select("id")
          .single();
        if (error) throw new Error(`The deck could not be saved: ${error.message}`);
        const artifactId = String((data as Record<string, unknown>).id);
        const title = `Flashcards · ${topic.slice(0, 60)}`;
        const artifact: CourseArtifactRef = {
          id: artifactId,
          kind: "flashcards",
          title,
          url: `/courses/${ctx.courseId}/study/${artifactId}`,
        };
        return {
          summary: `Generated ${title} (${deck.payload.cards.length} cards)`,
          result: { ok: true, artifact, cardCount: deck.payload.cards.length, topicKeys: deck.topicKeys },
          notice: { name, summary: `Generated ${title}`, artifact },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "The provider request failed.";
        return fail(isQuiz ? "Quiz generation failed" : "Flashcard generation failed", message);
      }
    }

    case "start_study_session": {
      try {
        const { session, created } = await createStudySession(ctx.client, ctx.courseId);
        const summary = created ? "Started a study session from weak areas" : "Resumed the active study session";
        return {
          summary,
          result: {
            ok: true,
            sessionId: session.id,
            created,
            steps: session.steps.map((step) => ({ key: step.key, kind: step.kind, status: step.status, title: step.title })),
          },
          notice: { name, summary, sessionId: session.id },
        };
      } catch (error) {
        return fail("Study session failed", error instanceof Error ? error.message : "The session could not be started.");
      }
    }

    default:
      return fail("Unknown tool", `The tool "${name}" is not available.`);
  }
}

export type CourseChatTurnResult = {
  text: string;
  citations: Citation[];
  answerBasis: AnswerBasis;
  profileUsed: boolean;
  readySources: number;
  artifacts: CourseArtifactRef[];
  studySessionId: string | null;
};

/** Course-level threads: notebook_id IS NULL (tutor threads carry a notebook). */
export async function listCourseThreads(client: SupabaseClient, courseId: string, offset = 0) {
  const { data, error } = await client
    .from("chat_threads")
    .select("id, course_id, notebook_id, title, updated_at")
    .eq("course_id", courseId)
    .is("notebook_id", null)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + 19);
  if (error) throw new Error(`Could not list course threads: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    courseId: String(row.course_id),
    notebookId: null,
    title: String(row.title),
    updatedAt: String(row.updated_at),
  }));
}

async function streamFinalAnswer(
  apiKey: string,
  textModel: string,
  messages: ChatWireMessage[],
  onDelta: (text: string) => void | Promise<void>,
): Promise<string> {
  const response = await textChatFetch(apiKey, {
    model: textModel,
    messages,
    temperature: 0.3,
    stream: true,
  });
  const reader = response.body?.getReader();
  if (!reader) throw { code: "unknown", message: "The text model returned an empty stream." } satisfies ProviderError;
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  const handleChunk = async (frame: string) => {
    const line = frame.trim();
    if (!line.startsWith("data:")) return;
    const data = line.slice("data:".length).trim();
    if (!data || data === "[DONE]") return;
    try {
      const payload = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
      const delta = payload.choices?.[0]?.delta?.content ?? "";
      if (delta) {
        fullText += delta;
        await onDelta(delta);
      }
    } catch {
      // Ignore malformed stream frames; the completed text persists.
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) await handleChunk(frame);
    }
    if (buffer.trim()) await handleChunk(buffer);
  } finally {
    reader.releaseLock();
  }
  return fullText;
}

/**
 * Runs one course-chat turn: context assembly, up to MAX_TOOL_CALLS
 * function calls, then a streamed final answer. Citations resolve only
 * against the turn's source registry — unknown ids never persist.
 */
export async function runCourseChatTurn(args: {
  client: SupabaseClient;
  memory: MemoryProvider;
  courseId: string;
  question: string;
  recentMessages: ChatMessage[];
  onTool: (notice: CourseChatNotice) => void | Promise<void>;
  onDelta: (text: string) => void | Promise<void>;
}): Promise<CourseChatTurnResult> {
  const { client, memory, courseId, question } = args;
  const { apiKey, textModel } = getFireworksServerConfig();

  const belongs = await courseBelongsToWorkspace(client, courseId, DEMO_WORKSPACE_ID);
  if (!belongs) throw new Error("The course was not found.");

  const { data: courseRow, error: courseError } = await client
    .from("courses")
    .select("id, title")
    .eq("id", courseId)
    .single();
  if (courseError) throw new Error("The course was not found.");
  const courseTitle = String((courseRow as Record<string, unknown>).title);

  const { data: notebookRows } = await client
    .from("notebooks")
    .select("id, title")
    .eq("course_id", courseId)
    .order("created_at", { ascending: true })
    .limit(50);
  const notebooks = ((notebookRows ?? []) as Record<string, unknown>[]).map((row) => ({
    notebookId: String(row.id),
    title: String(row.title),
  }));

  const localSources = await listSourcesByCourse(client, courseId);
  const readySources = localSources.filter((source) => source.status === "ready");
  const readyById = new Map(readySources.map((source) => [source.id, { id: source.id, title: source.title }]));

  let profile = { static: [] as string[], dynamic: [] as string[] };
  try {
    profile = await memory.getProfile();
  } catch {
    profile = { static: [], dynamic: [] };
  }
  const profileUsed = profile.static.length + profile.dynamic.length > 0;

  let learnerState = "";
  try {
    const [mastery, misconceptions] = await Promise.all([
      listTopicMastery(client, courseId),
      listActiveMisconceptions(client, courseId, 5),
    ]);
    learnerState = formatLearnerStateForPrompt({ mastery, misconceptions });
  } catch {
    learnerState = "";
  }

  const registry = new Map<string, RegistryEntry>();
  const ctx: ToolContext = { client, memory, courseId, courseTitle, registry, readyById, profileUsed, requestKey: "" };

  const history = args.recentMessages
    .slice(-8)
    .map((message) => `${message.role === "user" ? "Student" : "Companion"}: ${message.content.slice(0, 800)}`)
    .join("\n");

  const system = [
    `You are a study companion for the course "${courseTitle}".`,
    "Use tools when they help: search_sources when course material is relevant, get_mastery + get_misconceptions when the learner asks to drill weak spots or where they stand.",
    "When asked to make a teaching video, call create_video with the topic. It queues work; report the saved link and never imply a queued video is finished.",
    "Generate quizzes/flashcards with the generation tools when asked ('quiz me on X'); always confirm the topic first from the request, defaulting count to 4 questions / 6 cards.",
    "When you draw on retrieved passages, cite inline with [Sn] markers using ONLY the markers returned by search_sources this turn. Never invent a marker or source id. Otherwise just answer from knowledge.",
    "You can read notebooks to connect ideas across them. You cannot edit notebooks, save to notebooks, modify memory, or browse the web — say so if asked.",
    "Keep answers focused and course-scoped; never discuss other courses.",
  ].join(" ");

  const user = [
    `Course: ${courseTitle}`,
    notebooks.length > 0
      ? `Notebooks:\n${notebooks.map((entry) => `- ${entry.title} (${entry.notebookId})`).join("\n")}`
      : "Notebooks: none yet",
    `Ready sources: ${readySources.length}`,
    `Learner state:\n${learnerState || "No practice evidence yet."}`,
    history ? `Recent conversation:\n${history}` : "Recent conversation: none",
    `Student request: ${question}`,
  ].join("\n\n");

  const messages: ChatWireMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  const artifacts: CourseArtifactRef[] = [];
  let studySessionId: string | null = null;
  let toolCalls = 0;

  for (;;) {
    const response = await textChatFetch(apiKey, {
      model: textModel,
      messages,
      temperature: 0.3,
      tools: COURSE_CHAT_TOOLS,
      tool_choice: toolCalls >= MAX_TOOL_CALLS ? "none" : "auto",
    });
    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string | null;
          tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
        };
      }>;
    };
    const message = payload.choices?.[0]?.message;
    const calls = message?.tool_calls ?? [];
    if (calls.length === 0) {
      const text = (message?.content ?? "").trim() || "I could not put together an answer — try rephrasing the question.";
      // Fast path: no tools used, stream the completed text in chunks.
      for (let index = 0; index < text.length; index += 60) {
        await args.onDelta(text.slice(index, index + 60));
      }
      return finishTurn(text);
    }

    messages.push({
      role: "assistant",
      content: message?.content ?? null,
      tool_calls: calls.map((call) => ({ id: call.id, type: "function" as const, function: call.function })),
    });

    for (const call of calls) {
      if (toolCalls >= MAX_TOOL_CALLS) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify({ ok: false, error: "The tool budget for this turn is spent — answer with what you have." }),
        });
        continue;
      }
      toolCalls += 1;
      ctx.requestKey = `${args.recentMessages.filter((entry) => entry.role === "user").at(-1)?.id ?? crypto.randomUUID()}:${call.id}`;
      const outcome = await executeTool(ctx, call.function.name, parseArgs(call.function.arguments));
      if (outcome.notice.artifact) artifacts.push(outcome.notice.artifact);
      if (outcome.notice.sessionId) studySessionId = outcome.notice.sessionId;
      await args.onTool(outcome.notice);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: JSON.stringify(outcome.result).slice(0, 6000),
      });
    }

    if (toolCalls >= MAX_TOOL_CALLS) {
      const text = await streamFinalAnswer(apiKey, textModel, messages, args.onDelta);
      return finishTurn(text);
    }
  }

  function finishTurn(text: string): CourseChatTurnResult {
    const sources = [...registry.values()].map((entry) => ({
      marker: entry.marker,
      sourceId: entry.sourceId,
      title: entry.title,
      excerpt: entry.excerpt,
      locator: entry.locator,
    }));
    const citedIds = extractCitedSourceIds(text, sources);
    const citations = buildCitationsForSourceIds(citedIds, sources);
    return {
      text,
      citations,
      answerBasis: labelAnswerBasis(text, citations),
      profileUsed,
      readySources: readySources.length,
      artifacts,
      studySessionId,
    };
  }
}
