import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, readJson } from "@/lib/server/http";
import { toProviderError } from "@/lib/providers/types";
import {
  generateImageBytes,
  generateImagePlan,
  generateMermaidPayload,
} from "@/lib/server/generation";
import { userFacingProviderMessage } from "@/lib/server/source-ingestion";
import {
  ARTIFACT_COLUMNS,
  artifactEnvelopeFromRow,
  gatherVisualContext,
  storeGeneratedImage,
} from "@/lib/server/visual-generation";
import { imagePayloadSchema, mermaidPayloadSchema } from "@/lib/tutor";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

type RouteContext = { params: Promise<{ id: string }> };
type Row = Record<string, unknown>;

const retryInput = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  topic: z.string().trim().min(1).max(200).optional(),
});

/**
 * Retries (or regenerates) a failed mermaid/image artifact in place. The row
 * moves failed/ready -> generating -> ready (or back to failed with an
 * error), keeping the same artifact id so notebook nodes update without a
 * re-insert. Only mermaid/image kinds are in scope for ticket 04.
 */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return apiError("Artifact id is invalid.", 400);
  }

  let input: z.infer<typeof retryInput> = {};
  try {
    const body = await readJson(request).catch(() => ({}));
    input = retryInput.parse(body ?? {});
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }

  const client = createSupabaseAdminClient();

  try {
    const { data: existing, error: loadError } = await client
      .from("learning_artifacts")
      .select(ARTIFACT_COLUMNS)
      .eq("id", id)
      .single();
    if (loadError || !existing) return apiError("The artifact was not found.", 404);
    const row = existing as Row;

    if (row.kind !== "mermaid" && row.kind !== "image") {
      return apiError("Only diagram and image blocks can be retried.", 400);
    }
    if (row.status === "generating" || row.status === "pending") {
      return NextResponse.json(
        { error: "This block is already generating. Wait for it to finish, then retry.", retryable: true },
        { status: 409 },
      );
    }

    const storedPayload = (row.payload_json ?? {}) as Record<string, unknown>;
    const topic =
      input.topic ??
      (typeof storedPayload.topic === "string" && storedPayload.topic.trim() ? String(storedPayload.topic) : null) ??
      input.title ??
      "Notebook visual";
    const title = input.title ?? topic.slice(0, 120);

    await client.from("learning_artifacts").update({ status: "generating", error: null }).eq("id", id);

    const finish = async (patch: Record<string, unknown>) => {
      const { data: updated, error: updateError } = await client
        .from("learning_artifacts")
        .update(patch)
        .eq("id", id)
        .select(ARTIFACT_COLUMNS)
        .single();
      if (updateError) throw new Error(`The block could not be updated: ${updateError.message}`);
      return updated as Row;
    };

    const fail = async (error: unknown, retryPayload: Record<string, unknown>) => {
      const providerError = toProviderError(error);
      const message = `${userFacingProviderMessage(providerError.code, providerError.message)} The block was kept as failed — retry it without losing the notebook.`;
      const updated = await finish({ status: "failed", error: message, payload_json: retryPayload });
      return NextResponse.json(
        {
          artifact: artifactEnvelopeFromRow(updated, title, retryPayload),
          status: "failed",
          error: message,
          providerCode: providerError.code,
          retryable: true,
        },
        { status: 502 },
      );
    };

    const courseId = String(row.course_id);
    let contextResult: Awaited<ReturnType<typeof gatherVisualContext>>;
    try {
      contextResult = await gatherVisualContext(client, courseId, topic, "");
    } catch (error) {
      return fail(error, { topic });
    }

    if (row.kind === "mermaid") {
      try {
        const payload = await generateMermaidPayload({
          courseTitle: contextResult.courseTitle,
          topic,
          selectedText: "",
          sources: contextResult.retrieval,
          profile: contextResult.profile,
        });
        const ready = { code: payload.code, caption: payload.caption };
        mermaidPayloadSchema.parse(ready);
        const updated = await finish({
          status: "ready",
          error: null,
          payload_json: ready,
          source_ids: contextResult.sourceIds,
        });
        return NextResponse.json({
          artifact: artifactEnvelopeFromRow(updated, title, ready, contextResult.citations),
          status: "ready",
        });
      } catch (error) {
        return fail(error, { topic });
      }
    }

    // Image retry: reuse the stored prompt when one exists so a storage-only
    // failure does not spend a second planning call.
    let prompt = typeof storedPayload.prompt === "string" ? storedPayload.prompt : "";
    let alt = typeof storedPayload.alt === "string" ? storedPayload.alt : "";
    let caption = typeof storedPayload.caption === "string" ? storedPayload.caption : "";
    if (!prompt) {
      try {
        const plan = await generateImagePlan({
          courseTitle: contextResult.courseTitle,
          topic,
          selectedText: "",
          sources: contextResult.retrieval,
          profile: contextResult.profile,
        });
        prompt = plan.prompt;
        alt = plan.alt;
        caption = plan.caption;
      } catch (error) {
        return fail(error, { topic });
      }
    }

    let bytes: Awaited<ReturnType<typeof generateImageBytes>>;
    try {
      bytes = await generateImageBytes(prompt);
    } catch (error) {
      return fail(error, { topic, prompt, alt, caption });
    }

    let storagePath: string;
    try {
      storagePath = await storeGeneratedImage(client, courseId, bytes.bytes, bytes.mimeType);
    } catch (error) {
      return fail(error, { topic, prompt, alt, caption });
    }

    // Drop the previous bytes only after the replacement is stored.
    const previousPath =
      typeof storedPayload.storagePath === "string" ? storedPayload.storagePath : null;
    const ready = { prompt, storagePath, alt: alt || "Generated study image", caption: caption || title };
    try {
      imagePayloadSchema.parse(ready);
      const updated = await finish({
        status: "ready",
        error: null,
        payload_json: ready,
        source_ids: contextResult.sourceIds,
      });
      if (previousPath && previousPath !== storagePath) {
        await client.storage.from("generated-images").remove([previousPath]).catch(() => null);
      }
      return NextResponse.json({
        artifact: artifactEnvelopeFromRow(updated, title, ready, contextResult.citations),
        status: "ready",
      });
    } catch (error) {
      await client.storage.from("generated-images").remove([storagePath]).catch(() => null);
      return fail(error, { topic, prompt, alt, caption });
    }
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "The block could not be retried.");
  }
}
