export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];

export type NotebookDocument = {
  type: "doc";
  content?: JsonValue[];
};

export type Workspace = {
  id: string;
  name: string;
};

export type Course = {
  archivedAt?: string | null;
  id: string;
  workspaceId: string;
  title: string;
  color: string;
  notebooks: Notebook[];
};

export type Notebook = {
  id: string;
  courseId: string;
  title: string;
  contentJson: NotebookDocument;
  version: number;
  updatedAt: string;
};

export type WorkspaceResponse = {
  workspace: Workspace;
  courses: Course[];
};

export type NotebookSaveResult =
  | { status: "saved"; notebook: Notebook }
  | { status: "conflict"; notebook: Notebook };
