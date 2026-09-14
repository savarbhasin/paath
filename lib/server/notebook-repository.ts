import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/config";
import type { Course, Notebook, NotebookDocument, NotebookSaveResult, WorkspaceResponse } from "@/lib/domain";

type Row = Record<string, unknown>;

export interface WorkspaceRepository {
  getWorkspace(): Promise<WorkspaceResponse>;
  createCourse(input: { title: string; color: string }): Promise<Course>;
  createNotebook(input: { courseId: string; title: string }): Promise<Notebook>;
  saveNotebook(input: {
    notebookId: string;
    contentJson: NotebookDocument;
    expectedVersion: number;
  }): Promise<NotebookSaveResult>;
}

function asNotebook(row: Row): Notebook {
  return {
    id: String(row.id),
    courseId: String(row.course_id),
    title: String(row.title),
    contentJson: (row.content_json ?? { type: "doc", content: [{ type: "paragraph" }] }) as NotebookDocument,
    version: Number(row.version),
    updatedAt: String(row.updated_at),
  };
}

function asCourse(row: Row, notebooks: Notebook[]): Course {
  return {
    archivedAt: row.archived_at == null ? null : String(row.archived_at),
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    title: String(row.title),
    color: String(row.color),
    notebooks,
  };
}

export async function getWorkspace(client: SupabaseClient): Promise<WorkspaceResponse> {
  const { data: workspace, error: workspaceError } = await client
    .from("workspaces")
    .select("id, name")
    .eq("id", DEMO_WORKSPACE_ID)
    .eq("user_id", DEMO_USER_ID)
    .single();

  if (workspaceError) {
    throw new Error(`Could not load the demo workspace: ${workspaceError.message}`);
  }

  const { data: courseRows, error: courseError } = await client
    .from("courses")
    .select("id, workspace_id, title, color, archived_at")
    .eq("workspace_id", DEMO_WORKSPACE_ID)
    .order("created_at", { ascending: true });

  if (courseError) {
    throw new Error(`Could not load courses: ${courseError.message}`);
  }

  const courseIds = (courseRows ?? []).map((row) => row.id as string);
  const { data: notebookRows, error: notebookError } = courseIds.length
    ? await client
        .from("notebooks")
        .select("id, course_id, title, content_json, version, updated_at")
        .in("course_id", courseIds)
        .order("created_at", { ascending: true })
    : { data: [], error: null };

  if (notebookError) {
    throw new Error(`Could not load notebooks: ${notebookError.message}`);
  }

  const notebooksByCourse = new Map<string, Notebook[]>();
  for (const row of notebookRows ?? []) {
    const notebook = asNotebook(row as Row);
    const existing = notebooksByCourse.get(notebook.courseId) ?? [];
    existing.push(notebook);
    notebooksByCourse.set(notebook.courseId, existing);
  }

  return {
    workspace: { id: String(workspace.id), name: String(workspace.name) },
    courses: (courseRows ?? []).map((row) => asCourse(row as Row, notebooksByCourse.get(row.id as string) ?? [])),
  };
}

export async function createCourse(
  client: SupabaseClient,
  input: { title: string; color: string },
): Promise<Course> {
  const { data, error } = await client
    .from("courses")
    .insert({ workspace_id: DEMO_WORKSPACE_ID, title: input.title, color: input.color })
    .select("id, workspace_id, title, color")
    .single();

  if (error) {
    throw new Error(`Could not create course: ${error.message}`);
  }

  return asCourse(data as Row, []);
}

export async function createNotebook(
  client: SupabaseClient,
  input: { courseId: string; title: string },
): Promise<Notebook> {
  const { data, error } = await client
    .from("notebooks")
    .insert({
      course_id: input.courseId,
      title: input.title,
      content_json: { type: "doc", content: [{ type: "paragraph" }] },
      version: 1,
    })
    .select("id, course_id, title, content_json, version, updated_at")
    .single();

  if (error) {
    throw new Error(`Could not create notebook: ${error.message}`);
  }

  return asNotebook(data as Row);
}

export async function saveNotebook(
  client: SupabaseClient,
  input: { notebookId: string; contentJson: NotebookDocument; expectedVersion: number },
): Promise<NotebookSaveResult> {
  const { data, error } = await client
    .from("notebooks")
    .update({ content_json: input.contentJson, version: input.expectedVersion + 1 })
    .eq("id", input.notebookId)
    .eq("version", input.expectedVersion)
    .select("id, course_id, title, content_json, version, updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(`Could not save notebook: ${error.message}`);
  }

  if (data) {
    return { status: "saved", notebook: asNotebook(data as Row) };
  }

  const { data: current, error: currentError } = await client
    .from("notebooks")
    .select("id, course_id, title, content_json, version, updated_at")
    .eq("id", input.notebookId)
    .single();

  if (currentError) {
    throw new Error(`Could not inspect the notebook after a conflict: ${currentError.message}`);
  }

  return { status: "conflict", notebook: asNotebook(current as Row) };
}
