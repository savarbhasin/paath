import type { Citation } from "@/lib/contracts";

/** Learner identifier sent as Supermemory `containerTag`. One profile spans all courses. */
export const DEMO_LEARNER_CONTAINER_TAG = "nerdy-demo-learner";

/** Provider ceiling from the Supermemory docs. */
export const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

/**
 * PDF is the required format. DOC/DOCX/TXT/MD stay disabled until each one
 * passes the same live Supermemory probe (per ticket 02 scope).
 */
export const ENABLED_SOURCE_TYPES = [
  { extension: "pdf", mimeType: "application/pdf", label: "PDF" },
] as const;

export type EnabledSourceExtension = (typeof ENABLED_SOURCE_TYPES)[number]["extension"];

export type SourceType = "file" | "pdf" | "youtube";

export type SourceStatus = "uploading" | "queued" | "processing" | "ready" | "failed" | "retrying";

export type Source = {
  id: string;
  courseId: string;
  type: SourceType;
  title: string;
  url: string | null;
  storagePath: string | null;
  providerDocumentId: string | null;
  status: SourceStatus;
  error: string | null;
  updatedAt: string;
};

export type NormalizedSearchResult = {
  /** Local Supabase source id. Always present so every result opens its source. */
  sourceId: string;
  providerDocumentId: string | null;
  courseId: string | null;
  title: string;
  excerpt: string;
  similarity: number | null;
  locator?: Citation["locator"];
};

export type SearchScope = "course" | "workspace";

const EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "text/markdown": "md",
};

export function getFileExtension(filename: string): string {
  const base = filename.split(/[?#]/, 1)[0].split("/").pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function validateSourceFile(input: { filename: string; mimeType: string; size: number }): {
  ok: boolean;
  extension: string;
  reason?: string;
} {
  const extension = getFileExtension(input.filename);
  const enabled = ENABLED_SOURCE_TYPES.find((entry) => entry.extension === extension);

  if (!enabled || input.mimeType !== enabled.mimeType) {
    const expected = EXTENSION_BY_MIME[input.mimeType];
    const hint = expected ? `Files of that kind use a .${expected} extension.` : "Only PDF files are supported right now.";
    return { ok: false, extension, reason: `Unsupported file type. ${hint}` };
  }

  if (!Number.isFinite(input.size) || input.size <= 0) {
    return { ok: false, extension, reason: "The file looks empty. Choose a file with content." };
  }

  if (input.size > MAX_SOURCE_BYTES) {
    return { ok: false, extension, reason: `Files must be under ${MAX_SOURCE_BYTES / (1024 * 1024)} MB.` };
  }

  return { ok: true, extension };
}

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

export function normalizeYouTubeUrl(raw: string): { ok: boolean; url?: string; reason?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, reason: "Paste a public YouTube URL." };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "That URL is not valid. Paste a public YouTube watch or share link." };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "That URL is not valid. Paste a public YouTube watch or share link." };
  }

  if (!YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { ok: false, reason: "Only public YouTube URLs are supported." };
  }

  parsed.protocol = "https:";
  return { ok: true, url: parsed.toString() };
}

export function buildSourceStoragePath(courseId: string, sourceId: string, extension: string): string {
  return `${courseId}/${sourceId}.${extension}`;
}

export function supermemoryCustomId(sourceId: string): string {
  return `source-${sourceId}`;
}

export function supermemoryMetadata(input: { courseId: string; sourceId: string; sourceType: SourceType; title: string }) {
  return {
    courseId: input.courseId,
    sourceId: input.sourceId,
    sourceType: input.sourceType,
    title: input.title,
  };
}

export const TERMINAL_SOURCE_STATUSES: ReadonlySet<SourceStatus> = new Set(["ready", "failed"]);
