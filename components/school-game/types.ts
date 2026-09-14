// Shared data shapes for the school game. Read-only views over existing APIs.

export type NotebookInfo = {
  id: string;
  title: string;
  updatedAt: string | null;
};

export type CourseInfo = {
  id: string;
  title: string;
  color: string;
  notebooks: NotebookInfo[];
};

export type CourseStats = {
  attempts: number;
  reviews: number;
  sourcesReady: number;
  topics: Array<{ key: string; label: string; score: number; evidenceCount: number }>;
};

export type SchoolData = {
  workspaceName: string;
  courses: CourseInfo[];
  stats: Record<string, CourseStats>;
  offline: boolean;
};

export type ClassroomPanel = {
  course: CourseInfo;
  stats: CourseStats | null;
};
