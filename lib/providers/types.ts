import type { ArtifactEnvelope, Citation } from "@/lib/contracts";
import type { NormalizedSearchResult } from "@/lib/sources";

export type ProviderErrorCode = "invalid_request" | "rate_limited" | "unavailable" | "unknown";

export type ProviderError = {
  code: ProviderErrorCode;
  message: string;
};

/** Ingestion lifecycle owned by Supermemory. Local-only states live in `SourceStatus`. */
export type ProviderSourceStatus = "queued" | "processing" | "ready" | "failed";

export type SourceSearchResult = NormalizedSearchResult;

export type LearningEventInput = {
  id: string;
  courseId: string;
  text: string;
};

export interface MemoryProvider {
  ingestSource(input: {
    sourceId: string;
    courseId: string;
    title: string;
    sourceType: string;
    url?: string;
    storagePath?: string;
  }): Promise<{ providerDocumentId: string; status: ProviderSourceStatus }>;
  deleteSource(documentId: string): Promise<void>;
  getSourceStatus(providerDocumentId: string): Promise<ProviderSourceStatus>;
  search(input: {
    query: string;
    courseId?: string;
    limit?: number;
    allowedSourceIds?: string[];
    /**
     * "documents" returns raw source chunks for grounding. The tutor path
     * uses "hybrid" so learner-memory hits can also inform the answer;
     * hits that cannot be traced to a local source are still dropped.
     */
    searchMode?: "documents" | "hybrid";
  }): Promise<SourceSearchResult[]>;
  addLearningEvent(event: LearningEventInput): Promise<void>;
  getProfile(): Promise<{ static: string[]; dynamic: string[] }>;
}

export interface GenerationProvider {
  answerTutor(input: unknown): Promise<unknown>;
  generateArtifact(input: unknown): Promise<ArtifactEnvelope>;
  generateEditorOperation(input: unknown): Promise<unknown>;
}

export interface ImageProvider {
  generateImage(input: { prompt: string; alt: string }): Promise<{ bytes: Uint8Array; mimeType: string }>;
}

export function toProviderError(error: unknown): ProviderError {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    return error as ProviderError;
  }
  return { code: "unknown", message: error instanceof Error ? error.message : "The provider request failed." };
}

export function citationForResult(result: SourceSearchResult): Citation {
  return {
    sourceId: result.sourceId,
    title: result.title,
    excerpt: result.excerpt || undefined,
    locator: result.locator,
  };
}
