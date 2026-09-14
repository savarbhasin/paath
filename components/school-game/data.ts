// Read-only data layer for the school game.
// Never writes. On any failure it falls back to sample classrooms so the
// 3D world always has something to show (badged as an offline demo).

import type { CourseInfo, CourseStats, SchoolData } from "./types";

const SAMPLE: SchoolData = {
  workspaceName: "Demo High",
  offline: true,
  courses: [
    {
      id: "demo-fractions",
      title: "Fractions",
      color: "#2d6a4f",
      notebooks: [
        { id: "n1", title: " Pizza slices", updatedAt: null },
        { id: "n2", title: "Comparing fractions", updatedAt: null },
        { id: "n3", title: "Word problems", updatedAt: null },
      ],
    },
    {
      id: "demo-times",
      title: "Times Tables",
      color: "#2f7fe0",
      notebooks: [
        { id: "n1", title: "7s and 8s", updatedAt: null },
        { id: "n2", title: "Speed drills", updatedAt: null },
      ],
    },
    {
      id: "demo-reading",
      title: "Reading",
      color: "#d9a400",
      notebooks: [
        { id: "n1", title: "Volcano adventure", updatedAt: null },
        { id: "n2", title: "Vocab quest", updatedAt: null },
      ],
    },
    {
      id: "demo-spanish",
      title: "Spanish",
      color: "#d64545",
      notebooks: [{ id: "n1", title: "Market roleplay", updatedAt: null }],
    },
  ],
  stats: {
    "demo-fractions": {
      attempts: 12,
      reviews: 34,
      sourcesReady: 3,
      topics: [
        { key: "addition", label: "Addition", score: 0.8, evidenceCount: 6 },
        { key: "fractions", label: "Fractions", score: 0.55, evidenceCount: 5 },
      ],
    },
  },
};

type WorkspacePayload = {
  workspace?: { name?: string };
  courses?: Array<{
    id: string;
    title: string;
    color: string;
    archivedAt?: string | null;
    notebooks?: Array<{ id: string; title: string; updatedAt?: string | null }>;
  }>;
};

type DashboardPayload = {
  notebooks?: Array<{ id: string; title: string; updatedAt: string | null }>;
  sourceCounts?: { ready: number };
  mastery?: Array<{
    topicKey: string;
    displayLabel: string;
    score: number;
    evidenceCount: number;
  }>;
  totals?: { attempts: number; reviews: number };
};

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadSchoolData(): Promise<SchoolData> {
  try {
    const ws = await fetchJson<WorkspacePayload>("/api/workspace", 6000);
    const courses: CourseInfo[] = (ws.courses ?? [])
      .filter((c) => !c.archivedAt)
      .slice(0, 8)
      .map((c) => ({
        id: c.id,
        title: c.title,
        color: c.color,
        notebooks: (c.notebooks ?? []).map((n) => ({
          id: n.id,
          title: n.title,
          updatedAt: n.updatedAt ?? null,
        })),
      }));
    if (courses.length === 0) return { ...SAMPLE, workspaceName: ws.workspace?.name ?? SAMPLE.workspaceName };
    const stats: Record<string, CourseStats> = {};
    await Promise.all(
      courses.map(async (c) => {
        try {
          const d = await fetchJson<DashboardPayload>(
            `/api/courses/${encodeURIComponent(c.id)}/dashboard`,
            5000,
          );
          stats[c.id] = {
            attempts: d.totals?.attempts ?? 0,
            reviews: d.totals?.reviews ?? 0,
            sourcesReady: d.sourceCounts?.ready ?? 0,
            topics: (d.mastery ?? []).slice(0, 6).map((m) => ({
              key: m.topicKey,
              label: m.displayLabel || m.topicKey.replace(/[_-]/g, " "),
              score: m.score,
              evidenceCount: m.evidenceCount,
            })),
          };
        } catch {
          // per-course stats are optional; the room still opens
        }
      }),
    );
    return { workspaceName: ws.workspace?.name ?? "My School", courses, stats, offline: false };
  } catch {
    return SAMPLE;
  }
}
