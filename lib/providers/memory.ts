import "server-only";

import type { Citation } from "@/lib/contracts";
import { getSupermemoryServerConfig } from "@/lib/providers/server-clients";
import type {
  LearningEventInput,
  MemoryProvider,
  ProviderError,
  ProviderErrorCode,
  ProviderSourceStatus,
  SourceSearchResult,
} from "@/lib/providers/types";
import { DEMO_LEARNER_CONTAINER_TAG, supermemoryCustomId, supermemoryMetadata } from "@/lib/sources";

const DOCUMENTS_URL = "https://api.supermemory.ai/v3/documents";
const SEARCH_URL = "https://api.supermemory.ai/v4/search";
const PROFILE_URL = "https://api.supermemory.ai/v4/profile";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function errorCodeForStatus(status: number): ProviderErrorCode {
  if (status === 400 || status === 404 || status === 422) return "invalid_request";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "unknown";
}

async function readProviderError(response: Response, fallback: string): Promise<ProviderError> {
  let detail: string | null = null;
  try {
    const payload = asRecord(await response.json());
    detail = asString(payload?.message) ?? asString(payload?.error) ?? null;
  } catch {
    detail = null;
  }
  return {
    code: errorCodeForStatus(response.status),
    message: detail ?? `${fallback} (provider status ${response.status}).`,
  };
}

async function supermemoryFetch(
  apiKey: string,
  url: string,
  init: RequestInit,
  fallback: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", ...(init.headers ?? {}) },
    });
  } catch (error) {
    const providerError: ProviderError = {
      code: "unavailable",
      message: error instanceof Error ? `Supermemory is unreachable: ${error.message}` : "Supermemory is unreachable.",
    };
    throw providerError;
  }

  if (init.method === "DELETE" && response.status === 404) return null;

  if (!response.ok) {
    throw await readProviderError(response, fallback);
  }

  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function mapDocumentStatus(raw: unknown): ProviderSourceStatus {
  const status = typeof raw === "string" ? raw.toLowerCase() : "";
  if (status === "done" || status === "ready" || status === "completed" || status === "processed") return "ready";
  if (status === "failed" || status === "error" || status === "deleted") return "failed";
  if (status === "processing" || status === "indexing" || status === "extracting" || status === "chunking") {
    return "processing";
  }
  return "queued";
}

function locatorFromMetadata(metadata: JsonRecord | null): Citation["locator"] | undefined {
  if (!metadata) return undefined;
  const page = asString(metadata.page ?? metadata.pageNumber ?? metadata.page_number);
  if (page) return { kind: "page", value: page };
  const timestamp = asString(metadata.timestamp ?? metadata.time ?? metadata.startTime ?? metadata.start_time);
  if (timestamp) return { kind: "timestamp", value: timestamp };
  const section = asString(metadata.section ?? metadata.heading ?? metadata.chapter);
  if (section) return { kind: "section", value: section };
  return undefined;
}

function normalizeSearchResult(entry: unknown): SourceSearchResult | null {
  const record = asRecord(entry);
  if (!record) return null;
  const metadata = asRecord(record.metadata);
  const sourceId = metadata ? asString(metadata.sourceId ?? metadata.source_id) : null;
  // Results that cannot be traced back to a local source are unusable:
  // every rendered result must open its source record.
  if (!sourceId) return null;

  const excerpt =
    asString(record.chunk) ?? asString(record.memory) ?? asString(record.text) ?? asString(record.content) ?? "";
  const similarity = typeof record.similarity === "number" ? record.similarity : null;
  const providerDocumentId =
    (metadata ? asString(metadata.documentId ?? metadata.document_id ?? metadata.id) : null) ??
    asString(record.documentId ?? record.document_id) ??
    asString(record.id);

  return {
    sourceId,
    providerDocumentId,
    courseId: metadata ? asString(metadata.courseId ?? metadata.course_id) : null,
    title: (metadata ? asString(metadata.title) : null) ?? "Untitled source",
    excerpt,
    similarity,
    locator: locatorFromMetadata(metadata),
  };
}

export type SupermemoryMemoryProviderOptions = {
  apiKey?: string;
  containerTag?: string;
  fetchImpl?: typeof supermemoryFetch;
};

export function createSupermemoryMemoryProvider(options: SupermemoryMemoryProviderOptions = {}): MemoryProvider {
  const apiKey = options.apiKey ?? getSupermemoryServerConfig().apiKey;
  const containerTag = options.containerTag ?? DEMO_LEARNER_CONTAINER_TAG;
  const callProvider = options.fetchImpl ?? supermemoryFetch;

  return {
    async ingestSource(input) {
      if (!input.url) {
        const error: ProviderError = {
          code: "invalid_request",
          message: "A readable file URL or YouTube URL is required before ingestion.",
        };
        throw error;
      }

      const payload = await callProvider(apiKey, DOCUMENTS_URL, {
        method: "POST",
        body: JSON.stringify({
          content: input.url,
          customId: supermemoryCustomId(input.sourceId),
          containerTag,
          // Reference material must stay searchable without becoming a
          // claim about the learner, so it always ingests as superrag.
          taskType: "superrag",
          metadata: supermemoryMetadata({
            courseId: input.courseId,
            sourceId: input.sourceId,
            sourceType: input.sourceType === "youtube" ? "youtube" : "file",
            title: input.title,
          }),
        }),
      }, "Supermemory could not start ingestion");

      const record = asRecord(payload);
      const providerDocumentId = asString(record?.id ?? record?.documentId ?? record?.document_id);
      if (!providerDocumentId) {
        const error: ProviderError = {
          code: "unknown",
          message: "Supermemory accepted the source but returned no document id.",
        };
        throw error;
      }
      return { providerDocumentId, status: mapDocumentStatus(record?.status ?? "queued") };
    },

    async deleteSource(documentId) {
      await callProvider(apiKey, `${DOCUMENTS_URL}/${encodeURIComponent(documentId)}`,
        { method: "DELETE" }, "Supermemory could not delete the source");
    },

    async getSourceStatus(providerDocumentId) {
      const payload = await callProvider(
        apiKey,
        `${DOCUMENTS_URL}/${encodeURIComponent(providerDocumentId)}`,
        { method: "GET" },
        "Supermemory could not report ingestion status",
      );
      return mapDocumentStatus(asRecord(payload)?.status);
    },

    async search(input) {
      const query = input.query.trim();
      if (!query) return [];

      const filters = input.courseId ? { AND: [{ key: "courseId", value: input.courseId }] } : undefined;
      const payload = await callProvider(apiKey, SEARCH_URL, {
        method: "POST",
        body: JSON.stringify({
          q: query,
          containerTag,
          // "documents" skips extracted learner memories and returns raw
          // source chunks, which is what source search must rank. The tutor
          // path may pass "hybrid" so memory hits can inform the answer.
          searchMode: input.searchMode ?? "documents",
          limit: Math.min(Math.max(input.limit ?? 8, 1), 20),
          ...(filters ? { filters } : {}),
        }),
      }, "Supermemory search failed");

      const results = asRecord(payload)?.results;
      if (!Array.isArray(results)) return [];

      const allowed = input.allowedSourceIds ? new Set(input.allowedSourceIds) : null;
      const normalized: SourceSearchResult[] = [];
      for (const entry of results) {
        const result = normalizeSearchResult(entry);
        if (!result) continue;
        if (allowed && !allowed.has(result.sourceId)) continue;
        // Course filters are enforced provider-side, but results are
        // re-checked locally so one course never leaks into another.
        if (input.courseId && result.courseId && result.courseId !== input.courseId) continue;
        normalized.push(result);
      }
      return normalized;
    },

    async addLearningEvent(event: LearningEventInput) {
      await callProvider(apiKey, DOCUMENTS_URL, {
        method: "POST",
        body: JSON.stringify({
          content: event.text,
          customId: `learning-event-${event.id}`,
          containerTag,
          metadata: { courseId: event.courseId, eventId: event.id, kind: "learning_event" },
        }),
      }, "Supermemory could not record the learning event");
    },

    async getProfile() {
      const payload = await callProvider(apiKey, PROFILE_URL, {
        method: "POST",
        body: JSON.stringify({ containerTag }),
      }, "Supermemory could not load the learner profile");
      const profile = asRecord(asRecord(payload)?.profile);
      return {
        static: asStringArray(profile?.static),
        dynamic: asStringArray(profile?.dynamic),
      };
    },
  };
}
