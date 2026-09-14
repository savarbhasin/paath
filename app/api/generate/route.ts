import { NextResponse } from "next/server";
import { z } from "zod";

import { DEMO_WORKSPACE_ID } from "@/lib/config";
import type { ArtifactEnvelope } from "@/lib/contracts";
import { createSupermemoryMemoryProvider } from "@/lib/providers/memory";
import { toProviderError } from "@/lib/providers/types";
import {
  buildCitationsForSourceIds,
  chooseNotebookOutput,
  generateExplanationPayload,
  generateImageBytes,
  generateImagePlan,
  generateMermaidPayload,
} from "@/lib/server/generation";
import {
  deckCitations,
  generateAssessment,
  generateFlashcardDeck,
} from "@/lib/server/study-generation";
import { apiError, readJson } from "@/lib/server/http";
import { retryPendingMemorySyncs } from "@/lib/server/learner-memory";
import {
  formatLearnerStateForPrompt,
  listActiveMisconceptions,
  listTopicMastery,
} from "@/lib/server/mastery";
import { userFacingProviderMessage } from "@/lib/server/source-ingestion";
import { courseBelongsToWorkspace, listSourcesByCourse } from "@/lib/server/source-repository";
import type { TutorSourceContext } from "@/lib/server/tutor-context";
import {
  artifactEnvelopeFromRow,
  checkCourseNotebook,
  gatherVisualContext,
  insertFailedVisualArtifact,
  insertReadyVisualArtifact,
  storeGeneratedImage,
} from "@/lib/server/visual-generation";
import type { Citation } from "@/lib/contracts";
import { editorOperationSchema } from "@/lib/tutor";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const generateInput = editorOperationSchema.extend({
  courseId: z.string().uuid(),
  notebookId: z.string().uuid(),
  kind: z.enum(["auto", "explanation", "mermaid", "image", "flashcards", "assessment"]),
  topic: z.string().trim().min(1).max(200).default("Notebook explanation"),
  title: z.string().trim().min(1).max(120).optional(),
  selectedText: z.string().max(4000).nullable().optional(),
  explanationLocked: z.boolean().optional(),
  mode: z.enum(["practice", "quiz"]).default("practice"),
  count: z.number().int().min(1).max(8).optional(),
});

function providerFailure(error: unknown, action: string) {
  const providerError = toProviderError(error);
  return NextResponse.json(
    {
      error: `${userFacingProviderMessage(providerError.code, providerError.message)} ${action}`,
      providerCode: providerError.code,
      retryable: true,
    },
    { status: 502 },
  );
}

/**
 * Generates a validated artifact with Structured Outputs and returns it
 * alongside the requested editor operation. The browser applies the operation
 * through Tiptap and then saves the notebook version.
 *
 * A stale expected version returns 409 before any generation runs.
 * Explanation failures persist nothing, so the notebook is never touched.
 * Visual (mermaid/image) failures persist a `failed` artifact row plus the
 * operation, so the browser can insert an isolated failed block with Retry —
 * never a broken completed block.
 */
export async function POST(request: Request) {
  let input: z.infer<typeof generateInput>;
  try {
    input = generateInput.parse(await readJson(request));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return apiError("A valid course, notebook, topic, and operation are required.", 400);
    }
    return apiError("Request body must be valid JSON.", 400);
  }

  const client = createSupabaseAdminClient();

  try {
    const check = await checkCourseNotebook(client, DEMO_WORKSPACE_ID, input.courseId, input.notebookId);
    if (!check.ok) {
      if (check.status === 409 || "currentVersion" in check) {
        return NextResponse.json({ error: check.error, retryable: true }, { status: check.status });
      }
      return apiError(check.error, check.status);
    }

    if (check.notebookVersion !== input.expectedNotebookVersion) {
      return NextResponse.json(
        {
          error: "This notebook changed since the selection was made. Regenerate against the current selection.",
          currentVersion: check.notebookVersion,
          retryable: true,
        },
        { status: 409 },
      );
    }

    if (input.kind === "auto") {
      try {
        input.kind = await chooseNotebookOutput(input.topic, input.selectedText ?? "");
      } catch (error) {
        return providerFailure(error, "Nothing was added to the notebook. Try again.");
      }
    }

    // One review at a time: while a draft or freshly generated block awaits
    // accept/discard, every kind is refused so the pending review can never
    // be orphaned by a second insert.
    if (input.explanationLocked) {
      return apiError("Accept or discard the pending draft first.", 409);
    }

    if (input.kind === "mermaid") {
      return generateMermaid(client, input);
    }
    if (input.kind === "image") {
      return generateImage(client, input);
    }
    if (input.kind === "flashcards") {
      return generateDeck(client, input);
    }
    if (input.kind === "assessment") {
      return generateQuiz(client, input);
    }
    return generateExplanation(client, input);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not generate the content.");
  }
}

type GenerateInput = z.infer<typeof generateInput>;

function operationFor(input: GenerateInput, artifactId: string) {
  return {
    operation: input.operation,
    expectedNotebookVersion: input.expectedNotebookVersion,
    ...(input.anchorNodeId ? { anchorNodeId: input.anchorNodeId } : {}),
    ...(input.replacementRange ? { replacementRange: input.replacementRange } : {}),
    artifactId,
  };
}

async function generateExplanation(
  client: ReturnType<typeof createSupabaseAdminClient>,
  input: GenerateInput,
) {
  const memory = createSupermemoryMemoryProvider();

  const belongs = await courseBelongsToWorkspace(client, input.courseId, DEMO_WORKSPACE_ID);
  if (!belongs) return apiError("The course was not found.", 404);

  const { data: courseRow, error: courseError } = await client
    .from("courses")
    .select("id, title")
    .eq("id", input.courseId)
    .single();
  if (courseError) return apiError("The course was not found.", 404);
  const courseTitle = String((courseRow as Record<string, unknown>).title);

  const localSources = await listSourcesByCourse(client, input.courseId);
  const readySources = localSources.filter((source) => source.status === "ready");
  const localById = new Map(readySources.map((source) => [source.id, source]));

  const selectedText = (input.selectedText ?? "").trim().slice(0, 2000);

  let profile: { static: string[]; dynamic: string[] } = { static: [], dynamic: [] };
  try {
    profile = await memory.getProfile();
  } catch {
    profile = { static: [], dynamic: [] };
  }

  // The explanation path builds its own context: flush pending memory syncs
  // here too (idempotent by customId) so generation sees fresh learner state.
  try {
    await retryPendingMemorySyncs(client, memory, input.courseId);
  } catch {
    // Sync failures never block generation; rows stay marked for next time.
  }

  let retrieval: TutorSourceContext[] = [];
  if (readySources.length > 0) {
    try {
      const results = await memory.search({
        query: selectedText ? `${input.topic}\n\n${selectedText}` : input.topic,
        courseId: input.courseId,
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

  let payload: Awaited<ReturnType<typeof generateExplanationPayload>>;
  try {
    payload = await generateExplanationPayload({
      courseTitle,
      topic: input.topic,
      selectedText,
      sources: retrieval,
      profile: {
        static: profile.static.slice(0, 12),
        dynamic: profile.dynamic.slice(0, 12),
      },
      learnerState: await loadLearnerState(client, input.courseId),
    });
  } catch (error) {
    return providerFailure(error, "Nothing was added to the notebook — try generating again.");
  }

  // Attribute the artifact only to retrieval-returned source ids.
  const sourceIds = [...new Set(retrieval.map((entry) => entry.sourceId))].slice(0, 6);
  const citations = buildCitationsForSourceIds(sourceIds.slice(0, 4), retrieval);

  const title = input.title ?? input.topic;
  const { data: artifactRow, error: artifactError } = await client
    .from("learning_artifacts")
    .insert({
      course_id: input.courseId,
      notebook_id: input.notebookId,
      kind: "explanation",
      status: "ready",
      payload_json: payload,
      source_ids: sourceIds,
      error: null,
    })
    .select("id, course_id, notebook_id, kind, status, payload_json, source_ids, error")
    .single();

  if (artifactError) {
    return apiError(`The explanation was generated but could not be saved: ${artifactError.message}`);
  }
  const row = artifactRow as Record<string, unknown>;

  const artifact: ArtifactEnvelope = {
    id: String(row.id),
    kind: "explanation",
    title,
    sourceIds,
    topicKeys: [],
    citations,
    payload,
  };

  return NextResponse.json({ artifact, operation: operationFor(input, artifact.id) }, { status: 201 });
}

async function generateMermaid(
  client: ReturnType<typeof createSupabaseAdminClient>,
  input: GenerateInput,
) {
  const selectedText = (input.selectedText ?? "").trim().slice(0, 2000);
  const title = input.title ?? input.topic;

  let context: Awaited<ReturnType<typeof gatherVisualContext>>;
  try {
    context = await gatherVisualContext(client, input.courseId, input.topic, selectedText);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not generate the diagram.");
  }

  try {
    const payload = await generateMermaidPayload({
      courseTitle: context.courseTitle,
      topic: input.topic,
      selectedText,
      sources: context.retrieval,
      profile: context.profile,
      learnerState: context.learnerState,
    });
    const row = await insertReadyVisualArtifact(client, {
      courseId: input.courseId,
      notebookId: input.notebookId,
      kind: "mermaid",
      sourceIds: context.sourceIds,
      payload: { code: payload.code, caption: payload.caption },
    });
    const artifact = artifactEnvelopeFromRow(row, title, payload, context.citations);
    return NextResponse.json(
      { artifact, status: "ready" as const, operation: operationFor(input, artifact.id) },
      { status: 201 },
    );
  } catch (error) {
    return persistVisualFailure(client, input, "mermaid", title, context.sourceIds, error, {
      topic: input.topic,
    });
  }
}

async function generateImage(
  client: ReturnType<typeof createSupabaseAdminClient>,
  input: GenerateInput,
) {
  const selectedText = (input.selectedText ?? "").trim().slice(0, 2000);
  const title = input.title ?? input.topic;

  let context: Awaited<ReturnType<typeof gatherVisualContext>>;
  try {
    context = await gatherVisualContext(client, input.courseId, input.topic, selectedText);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not generate the image.");
  }

  const fail = async (error: unknown, retryPayload: Record<string, unknown>) =>
    persistVisualFailure(client, input, "image", title, context.sourceIds, error, retryPayload);

  let plan: Awaited<ReturnType<typeof generateImagePlan>>;
  try {
    plan = await generateImagePlan({
      courseTitle: context.courseTitle,
      topic: input.topic,
      selectedText,
      sources: context.retrieval,
      profile: context.profile,
      learnerState: context.learnerState,
    });
  } catch (error) {
    return fail(error, { topic: input.topic });
  }

  let bytes: Awaited<ReturnType<typeof generateImageBytes>>;
  try {
    bytes = await generateImageBytes(plan.prompt);
  } catch (error) {
    // Keep the plan so Retry can skip straight to rendering bytes.
    return fail(error, { topic: input.topic, prompt: plan.prompt, alt: plan.alt, caption: plan.caption });
  }

  let storagePath: string;
  try {
    storagePath = await storeGeneratedImage(client, input.courseId, bytes.bytes, bytes.mimeType);
  } catch (error) {
    return fail(error, { topic: input.topic, prompt: plan.prompt, alt: plan.alt, caption: plan.caption });
  }

  const payload = { prompt: plan.prompt, storagePath, alt: plan.alt, caption: plan.caption };
  try {
    const row = await insertReadyVisualArtifact(client, {
      courseId: input.courseId,
      notebookId: input.notebookId,
      kind: "image",
      sourceIds: context.sourceIds,
      payload,
    });
    const artifact = artifactEnvelopeFromRow(row, title, payload, context.citations);
    return NextResponse.json(
      { artifact, status: "ready" as const, operation: operationFor(input, artifact.id) },
      { status: 201 },
    );
  } catch (error) {
    await client.storage.from("generated-images").remove([storagePath]).catch(() => null);
    return apiError(error instanceof Error ? error.message : "The generated image could not be saved.");
  }
}

/**
 * Generates a validated flashcard deck from the selection or ready sources.
 * Failures persist nothing, so malformed model output creates no usable deck
 * and the notebook is never touched — generating again is the retry.
 */
async function generateDeck(
  client: ReturnType<typeof createSupabaseAdminClient>,
  input: GenerateInput,
) {
  const selectedText = (input.selectedText ?? "").trim().slice(0, 2000);
  const title = input.title ?? input.topic;
  const count = Math.min(Math.max(input.count ?? 6, 1), 8);

  let context: Awaited<ReturnType<typeof gatherVisualContext>>;
  try {
    context = await gatherVisualContext(client, input.courseId, input.topic, selectedText);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not generate the flashcards.");
  }

  let deck: Awaited<ReturnType<typeof generateFlashcardDeck>>;
  try {
    deck = await generateFlashcardDeck(
      {
        courseTitle: context.courseTitle,
        topic: input.topic,
        selectedText,
        sources: context.retrieval,
        profile: context.profile,
        learnerState: context.learnerState,
      },
      formatStudySources(context.retrieval),
      count,
    );
  } catch (error) {
    return providerFailure(error, "Nothing was added to the notebook — try generating again.");
  }

  const { data: artifactRow, error: artifactError } = await client
    .from("learning_artifacts")
    .insert({
      course_id: input.courseId,
      notebook_id: input.notebookId,
      kind: "flashcards",
      status: "ready",
      payload_json: deck.payload,
      source_ids: context.sourceIds,
      error: null,
    })
    .select("id, course_id, notebook_id, kind, status, payload_json, source_ids, error")
    .single();
  if (artifactError) {
    return apiError(`The deck was generated but could not be saved: ${artifactError.message}`);
  }

  const artifact: ArtifactEnvelope = {
    id: String((artifactRow as Record<string, unknown>).id),
    kind: "flashcards",
    title,
    sourceIds: context.sourceIds,
    topicKeys: deck.topicKeys,
    citations: deckCitations(context.sourceIds, context.retrieval),
    payload: deck.payload,
  };
  return NextResponse.json({ artifact, operation: operationFor(input, artifact.id) }, { status: 201 });
}

/**
 * Generates a validated practice set or quiz. OpenAI writes questions and
 * explanations; correctness is decided later by exact set comparison in
 * server code. Malformed output persists nothing and can be retried.
 */
async function generateQuiz(
  client: ReturnType<typeof createSupabaseAdminClient>,
  input: GenerateInput,
) {
  const selectedText = (input.selectedText ?? "").trim().slice(0, 2000);
  const title = input.title ?? input.topic;
  const count = Math.min(Math.max(input.count ?? 4, 1), 8);

  let context: Awaited<ReturnType<typeof gatherVisualContext>>;
  try {
    context = await gatherVisualContext(client, input.courseId, input.topic, selectedText);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not generate the assessment.");
  }

  let assessment: Awaited<ReturnType<typeof generateAssessment>>;
  try {
    assessment = await generateAssessment(
      {
        courseTitle: context.courseTitle,
        topic: input.topic,
        selectedText,
        sources: context.retrieval,
        profile: context.profile,
        learnerState: context.learnerState,
      },
      formatStudySources(context.retrieval),
      input.mode,
      count,
    );
  } catch (error) {
    return providerFailure(error, "Nothing was added to the notebook — try generating again.");
  }

  const { data: artifactRow, error: artifactError } = await client
    .from("learning_artifacts")
    .insert({
      course_id: input.courseId,
      notebook_id: input.notebookId,
      kind: "assessment",
      status: "ready",
      payload_json: assessment.payload,
      source_ids: context.sourceIds,
      error: null,
    })
    .select("id, course_id, notebook_id, kind, status, payload_json, source_ids, error")
    .single();
  if (artifactError) {
    return apiError(`The assessment was generated but could not be saved: ${artifactError.message}`);
  }

  const artifact: ArtifactEnvelope = {
    id: String((artifactRow as Record<string, unknown>).id),
    kind: "assessment",
    title,
    sourceIds: context.sourceIds,
    topicKeys: assessment.topicKeys,
    citations: context.citations,
    payload: assessment.payload,
  };
  return NextResponse.json({ artifact, operation: operationFor(input, artifact.id) }, { status: 201 });
}

/**
 * Ticket 06: compact learner-state block for content-generation prompts.
 * Lookup failures degrade to an empty string, never to an error.
 */
async function loadLearnerState(
  client: ReturnType<typeof createSupabaseAdminClient>,
  courseId: string,
): Promise<string> {
  try {
    const [mastery, misconceptions] = await Promise.all([
      listTopicMastery(client, courseId),
      listActiveMisconceptions(client, courseId, 5),
    ]);
    return formatLearnerStateForPrompt({ mastery, misconceptions });
  } catch {
    return "";
  }
}

function formatStudySources(retrieval: TutorSourceContext[]): string {  if (retrieval.length === 0) {
    return "No source passages were retrieved. There is no course evidence for this topic.";
  }
  const passages = retrieval
    .map((source) => `[${source.sourceId}] ${source.title}\n${source.excerpt}`)
    .join("\n\n");
  const ids = retrieval.map((source) => source.sourceId).join(", ");
  return `${passages}\n\nUsable source ids (cite only these): ${ids}`;
}

/**
 * Persists a `failed` visual row (never a broken completed block) and returns
 * it with the editor operation, so the browser inserts an isolated failed
 * block carrying its own Retry action. The notebook stays editable.
 */
async function persistVisualFailure(
  client: ReturnType<typeof createSupabaseAdminClient>,
  input: GenerateInput,
  kind: "mermaid" | "image",
  title: string,
  sourceIds: string[],
  error: unknown,
  retryPayload: Record<string, unknown>,
) {
  const providerError = toProviderError(error);
  const message = `${userFacingProviderMessage(providerError.code, providerError.message)} The block was kept as failed — retry it without losing the notebook.`;
  try {
    const row = await insertFailedVisualArtifact(client, {
      courseId: input.courseId,
      notebookId: input.notebookId,
      kind,
      sourceIds,
      error: message,
      retryPayload,
    });
    const artifact: ArtifactEnvelope = {
      id: String((row as Record<string, unknown>).id),
      kind,
      title,
      sourceIds,
      topicKeys: [],
      citations: [] as Citation[],
      payload: retryPayload,
    };
    return NextResponse.json(
      {
        artifact,
        status: "failed" as const,
        error: message,
        providerCode: providerError.code,
        retryable: true,
        operation: operationFor(input, artifact.id),
      },
      { status: 502 },
    );
  } catch {
    return providerFailure(error, "Nothing was added to the notebook — try generating again.");
  }
}
