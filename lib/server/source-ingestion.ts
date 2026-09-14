import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { SOURCE_BUCKET } from "@/lib/config";
import { createSupermemoryMemoryProvider } from "@/lib/providers/memory";
import { toProviderError } from "@/lib/providers/types";
import { getSource, updateSource } from "@/lib/server/source-repository";
import type { Source } from "@/lib/sources";

const SIGNED_READ_URL_TTL_SECONDS = 60 * 60;

export function userFacingProviderMessage(code: string, fallback: string): string {
  if (code === "rate_limited") return "Supermemory is rate-limited right now. Wait a moment, then retry.";
  if (code === "unavailable") return "Supermemory is unreachable right now. The source is kept and can be retried.";
  if (code === "invalid_request") return fallback;
  return `${fallback} The source is kept and can be retried.`;
}

export async function getReadableSourceUrl(
  client: SupabaseClient,
  source: Source,
  expiresIn = SIGNED_READ_URL_TTL_SECONDS,
): Promise<string | null> {
  if (source.type === "youtube") return source.url;
  if (!source.storagePath) return null;
  const { data, error } = await client.storage.from(SOURCE_BUCKET).createSignedUrl(source.storagePath, expiresIn);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function storageObjectExists(
  client: SupabaseClient,
  storagePath: string,
): Promise<boolean> {
  const slash = storagePath.lastIndexOf("/");
  const directory = slash > 0 ? storagePath.slice(0, slash) : "";
  const filename = slash >= 0 ? storagePath.slice(slash + 1) : storagePath;
  const { data, error } = await client.storage.from(SOURCE_BUCKET).list(directory, { search: filename });
  if (error) return false;
  return (data ?? []).some((entry) => entry.name === filename);
}

/**
 * Sends a local source to Supermemory with the same status model for files
 * and YouTube URLs. A retry keeps the same source id, so `customId` stays
 * stable and the provider deduplicates instead of duplicating.
 */
export async function submitSourceForIngestion(
  client: SupabaseClient,
  source: Source,
): Promise<Source> {
  const provider = createSupermemoryMemoryProvider();
  const url = await getReadableSourceUrl(client, source);

  if (!url) {
    return updateSource(client, source.id, {
      status: "failed",
      error:
        source.type === "youtube"
          ? "The YouTube URL is missing."
          : "The uploaded file is missing from storage. Upload it again, then retry.",
    });
  }

  try {
    const { providerDocumentId, status } = await provider.ingestSource({
      sourceId: source.id,
      courseId: source.courseId,
      title: source.title,
      sourceType: source.type,
      url,
    });

    // Deletion may finish while the provider accepts an in-flight submission.
    // Remove that late document instead of leaving it behind in the index.
    if (!(await getSource(client, source.id))) {
      await provider.deleteSource(providerDocumentId);
      throw new Error("The source was deleted during ingestion.");
    }

    if (status === "ready") {
      return updateSource(client, source.id, { providerDocumentId, status: "ready", error: null });
    }
    if (status === "failed") {
      return updateSource(client, source.id, {
        providerDocumentId,
        status: "failed",
        error: "Supermemory rejected the source during processing.",
      });
    }
    return updateSource(client, source.id, {
      providerDocumentId,
      status: status === "processing" ? "processing" : "queued",
      error: null,
    });
  } catch (error) {
    const providerError = toProviderError(error);
    return updateSource(client, source.id, {
      status: "failed",
      error: userFacingProviderMessage(providerError.code, providerError.message),
    });
  }
}
