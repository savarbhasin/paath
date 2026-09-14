import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Source, SourceStatus, SourceType } from "@/lib/sources";

type Row = Record<string, unknown>;

export function asSource(row: Row): Source {
  return {
    id: String(row.id),
    courseId: String(row.course_id),
    type: row.type as SourceType,
    title: String(row.title),
    url: row.url == null ? null : String(row.url),
    storagePath: row.storage_path == null ? null : String(row.storage_path),
    providerDocumentId:
      row.supermemory_document_id == null ? null : String(row.supermemory_document_id),
    status: row.status as SourceStatus,
    error: row.error == null ? null : String(row.error),
    updatedAt: String(row.updated_at),
  };
}

const SOURCE_COLUMNS =
  "id, course_id, type, title, url, storage_path, supermemory_document_id, status, error, updated_at";

export async function createSource(
  client: SupabaseClient,
  input: { courseId: string; type: SourceType; title: string; url?: string; storagePath?: string },
): Promise<Source> {
  const { data, error } = await client
    .from("sources")
    .insert({
      course_id: input.courseId,
      type: input.type,
      title: input.title,
      url: input.url ?? null,
      storage_path: input.storagePath ?? null,
      status: "uploading",
      error: null,
    })
    .select(SOURCE_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Could not create the source: ${error.message}`);
  }
  return asSource(data as Row);
}

export async function getSource(client: SupabaseClient, sourceId: string): Promise<Source | null> {
  const { data, error } = await client.from("sources").select(SOURCE_COLUMNS).eq("id", sourceId).maybeSingle();
  if (error) {
    throw new Error(`Could not load the source: ${error.message}`);
  }
  return data ? asSource(data as Row) : null;
}

export async function listSourcesByCourse(client: SupabaseClient, courseId: string): Promise<Source[]> {
  const { data, error } = await client
    .from("sources")
    .select(SOURCE_COLUMNS)
    .eq("course_id", courseId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Could not list sources: ${error.message}`);
  }
  return (data ?? []).map((row) => asSource(row as Row));
}

export async function listSourcesByCourseIds(
  client: SupabaseClient,
  courseIds: string[],
): Promise<Source[]> {
  if (courseIds.length === 0) return [];
  const { data, error } = await client
    .from("sources")
    .select(SOURCE_COLUMNS)
    .in("course_id", courseIds)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Could not list sources: ${error.message}`);
  }
  return (data ?? []).map((row) => asSource(row as Row));
}

export async function updateSource(
  client: SupabaseClient,
  sourceId: string,
  patch: Partial<{
    title: string;
    storagePath: string | null;
    providerDocumentId: string | null;
    status: SourceStatus;
    error: string | null;
  }>,
): Promise<Source> {
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.storagePath !== undefined) update.storage_path = patch.storagePath;
  if (patch.providerDocumentId !== undefined) update.supermemory_document_id = patch.providerDocumentId;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.error !== undefined) update.error = patch.error;

  const { data, error } = await client
    .from("sources")
    .update(update)
    .eq("id", sourceId)
    .select(SOURCE_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Could not update the source: ${error.message}`);
  }
  return asSource(data as Row);
}

export async function listWorkspaceCourseIds(
  client: SupabaseClient,
  workspaceId: string,
): Promise<string[]> {
  const { data, error } = await client.from("courses").select("id").eq("workspace_id", workspaceId);
  if (error) {
    throw new Error(`Could not list workspace courses: ${error.message}`);
  }
  return (data ?? []).map((row) => String((row as Row).id));
}

export async function courseBelongsToWorkspace(  client: SupabaseClient,
  courseId: string,
  workspaceId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not verify the course: ${error.message}`);
  }
  return data !== null;
}
