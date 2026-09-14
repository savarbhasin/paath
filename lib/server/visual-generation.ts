import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { GENERATED_IMAGE_BUCKET } from "@/lib/config";
import type { ArtifactEnvelope, Citation } from "@/lib/contracts";
import { createSupermemoryMemoryProvider } from "@/lib/providers/memory";
import { citationForResult } from "@/lib/providers/types";
import { retryPendingMemorySyncs } from "@/lib/server/learner-memory";
import {
  formatLearnerStateForPrompt,
  listActiveMisconceptions,
  listTopicMastery,
} from "@/lib/server/mastery";
import type { TutorSourceContext } from "@/lib/server/tutor-context";
import { courseBelongsToWorkspace, listSourcesByCourse } from "@/lib/server/source-repository";

export type VisualContext = {
  courseTitle: string;
  profile: { static: string[]; dynamic: string[] };
  retrieval: TutorSourceContext[];
  sourceIds: string[];
  citations: Citation[];
  /** Ticket 06 learner state (misconceptions + mastery) for content requests. */
  learnerState: string;
};

export type CourseNotebookCheck =
  | { ok: true; notebookVersion: number }
  | { ok: false; status: number; error: string; currentVersion?: number };

/**
 * Verifies course ownership and notebook membership, then gathers the shared
 * visual-generation context: course title, learner profile, and retrieval
 * restricted to ready sources. Retrieval failures degrade to an empty source
 * set rather than failing generation.
 */
export async function checkCourseNotebook(
  client: SupabaseClient,
  workspaceId: string,
  courseId: string,
  notebookId: string,
): Promise<CourseNotebookCheck> {
  const belongs = await courseBelongsToWorkspace(client, courseId, workspaceId);
  if (!belongs) return { ok: false, status: 404, error: "The course was not found." };

  const { data: notebookRow, error: notebookError } = await client
    .from("notebooks")
    .select("id, course_id, version")
    .eq("id", notebookId)
    .single();
  if (notebookError) return { ok: false, status: 404, error: "The notebook was not found." };
  const notebook = notebookRow as Record<string, unknown>;
  if (String(notebook.course_id) !== courseId) {
    return { ok: false, status: 400, error: "The notebook does not belong to this course." };
  }
  return { ok: true, notebookVersion: Number(notebook.version) };
}

export async function gatherVisualContext(
  client: SupabaseClient,
  courseId: string,
  topic: string,
  selectedText: string,
): Promise<VisualContext> {
  const { data: courseRow, error: courseError } = await client
    .from("courses")
    .select("id, title")
    .eq("id", courseId)
    .single();
  if (courseError) throw new Error("The course was not found.");
  const courseTitle = String((courseRow as Record<string, unknown>).title);

  const memory = createSupermemoryMemoryProvider();
  const localSources = await listSourcesByCourse(client, courseId);
  const readySources = localSources.filter((source) => source.status === "ready");
  const localById = new Map(readySources.map((source) => [source.id, source]));

  // Content-generation requests also flush pending memory syncs (idempotent
  // by customId) so generated decks, quizzes, and visuals see fresh state.
  try {
    await retryPendingMemorySyncs(client, memory, courseId);
  } catch {
    // Sync failures never block generation; rows stay marked for next time.
  }

  let profile: VisualContext["profile"] = { static: [], dynamic: [] };
  try {
    profile = await memory.getProfile();
  } catch {
    profile = { static: [], dynamic: [] };
  }

  let retrieval: TutorSourceContext[] = [];
  if (readySources.length > 0) {
    try {
      const results = await memory.search({
        query: selectedText ? `${topic}\n\n${selectedText}` : topic,
        courseId,
        limit: 6,
        allowedSourceIds: readySources.map((source) => source.id),
        searchMode: "hybrid",
      });
      retrieval = results.slice(0, 6).flatMap((result, index) => {
        const local = localById.get(result.sourceId);
        if (!local) return [];
        return [
          {
            marker: `S${index + 1}`,
            sourceId: result.sourceId,
            title: local.title,
            excerpt: result.excerpt.slice(0, 700),
            locator: result.locator,
          },
        ];
      });
    } catch {
      retrieval = [];
    }
  }

  // Attribute the artifact only to retrieval-returned source ids.
  const sourceIds = [...new Set(retrieval.map((entry) => entry.sourceId))].slice(0, 6);
  const citations = sourceIds.slice(0, 4).flatMap((sourceId) => {
    const entry = retrieval.find((candidate) => candidate.sourceId === sourceId);
    if (!entry) return [];
    return [
      citationForResult({
        sourceId: entry.sourceId,
        providerDocumentId: null,
        courseId: null,
        title: entry.title,
        excerpt: entry.excerpt,
        similarity: null,
        locator: entry.locator,
      }),
    ];
  });

  // Local learner state shapes generated content the same way it shapes the
  // tutor: misconceptions get addressed, strong topics are not retaught.
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

  return {
    courseTitle,
    profile: {
      static: profile.static.slice(0, 12),
      dynamic: profile.dynamic.slice(0, 12),
    },
    retrieval,
    sourceIds,
    citations,
    learnerState,
  };
}

type ArtifactRow = Record<string, unknown>;

export function artifactEnvelopeFromRow(
  row: ArtifactRow,
  title: string,
  payload: unknown,
  citations: Citation[] = [],
): ArtifactEnvelope {
  return {
    id: String(row.id),
    kind: row.kind as ArtifactEnvelope["kind"],
    title,
    sourceIds: Array.isArray(row.source_ids) ? (row.source_ids as string[]) : [],
    topicKeys: [],
    citations,
    payload,
  };
}

export const ARTIFACT_COLUMNS =
  "id, course_id, notebook_id, kind, status, payload_json, source_ids, error";

/**
 * Persists a failed visual artifact row so the notebook can show an isolated
 * failed block with Retry. `payload_json` keeps just enough to retry (e.g.
 * the image prompt); it is NOT a completed block.
 */
export async function insertFailedVisualArtifact(
  client: SupabaseClient,
  input: {
    courseId: string;
    notebookId: string;
    kind: "mermaid" | "image";
    sourceIds: string[];
    error: string;
    retryPayload: Record<string, unknown>;
  },
): Promise<ArtifactRow> {
  const { data, error } = await client
    .from("learning_artifacts")
    .insert({
      course_id: input.courseId,
      notebook_id: input.notebookId,
      kind: input.kind,
      status: "failed",
      payload_json: input.retryPayload,
      source_ids: input.sourceIds,
      error: input.error,
    })
    .select(ARTIFACT_COLUMNS)
    .single();
  if (error) throw new Error(`The failed block could not be saved: ${error.message}`);
  return data as ArtifactRow;
}

export async function insertReadyVisualArtifact(
  client: SupabaseClient,
  input: {
    courseId: string;
    notebookId: string;
    kind: "mermaid" | "image";
    sourceIds: string[];
    payload: Record<string, unknown>;
  },
): Promise<ArtifactRow> {
  const { data, error } = await client
    .from("learning_artifacts")
    .insert({
      course_id: input.courseId,
      notebook_id: input.notebookId,
      kind: input.kind,
      status: "ready",
      payload_json: input.payload,
      source_ids: input.sourceIds,
      error: null,
    })
    .select(ARTIFACT_COLUMNS)
    .single();
  if (error) throw new Error(`The generated block could not be saved: ${error.message}`);
  return data as ArtifactRow;
}

/** Copies generated image bytes into private Supabase Storage. Returns the storage path. */
export async function storeGeneratedImage(
  client: SupabaseClient,
  courseId: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  const extension = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
  const filename = `${crypto.randomUUID()}.${extension}`;
  const storagePath = `${courseId}/${filename}`;
  const { error } = await client.storage
    .from(GENERATED_IMAGE_BUCKET)
    .upload(storagePath, Buffer.from(bytes), { contentType: mimeType, upsert: false });
  if (error) throw new Error(`The generated image could not be stored: ${error.message}`);
  return storagePath;
}

/** A fresh short-lived signed URL for a private generated image. Never stored. */
export async function getGeneratedImageUrl(
  client: SupabaseClient,
  storagePath: string,
  expiresIn = 5 * 60,
): Promise<string | null> {
  if (!storagePath || storagePath.includes("..")) return null;
  const { data, error } = await client.storage
    .from(GENERATED_IMAGE_BUCKET)
    .createSignedUrl(storagePath, expiresIn);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
