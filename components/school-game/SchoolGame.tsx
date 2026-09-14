 "use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, DoorOpen, X } from "lucide-react";

import { loadSchoolData } from "./data";
import { SchoolGame } from "./game";
import type { ClassroomPanel, SchoolData } from "./types";

export function SchoolGameView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<SchoolGame | null>(null);
  const [data, setData] = useState<SchoolData | null>(null);
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);
  const [prompt, setPrompt] = useState<{ label: string; kind: "door" | "desk" | "exit" } | null>(null);
  const [area, setArea] = useState({ title: "Main Corridor", sub: "Pick a classroom" });
  const [panel, setPanel] = useState<ClassroomPanel | null>(null);
  const [locked, setLocked] = useState(false);
  const [offline, setOffline] = useState(false);
  const [courseCount, setCourseCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadSchoolData()
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setOffline(d.offline);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || gameRef.current) return;
    try {
      const game = new SchoolGame(canvas, data, {
        onPrompt: (label, kind) => setPrompt(label ? { label, kind } : null),
        onArea: (title, sub) => setArea({ title, sub }),
        onPanel: (p) => {
          setPanel(p);
          gameRef.current?.setPanelOpen(p !== null);
        },
        onLock: setLocked,
        onReady: (n, off) => {
          setCourseCount(n);
          setOffline(off);
        },
      });
      gameRef.current = game;
      // headless/debug handle (harmless in production)
      (window as unknown as { __school?: object }).__school = {
        snap: () => game.snapshot(),
        teleport: (a: string) => game.debugTeleport(a),
        look: (y: number, p: number) => game.debugLook(y, p),
        key: (k: string, d: boolean) => game.debugKey(k, d),
        step: (n: number) => game.debugStep(n),
        shot: () => game.debugShot(),
        interact: () => game.interact(),
      };
    } catch {
      setFailed(true);
    }
    return () => {
      gameRef.current?.dispose();
      gameRef.current = null;
    };
  }, [data]);

  const start = useCallback(() => {
    setStarted(true);
    gameRef.current?.captureMouse();
  }, []);

  const closePanel = useCallback(() => {
    setPanel(null);
    gameRef.current?.setPanelOpen(false);
  }, []);

  return (
    <div className="fixed inset-0 z-40 bg-[#05090d] font-body text-white">
      <div className="absolute inset-0">
        <canvas
          ref={canvasRef}
          className="block h-full w-full"
          onClick={() => {
            if (started) gameRef.current?.captureMouse();
          }}
        />
      </div>

      {/* top-left: area card */}
      <div className="pointer-events-none absolute left-4 top-4 border border-white/15 bg-black/55 px-4 py-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#7bc79a]">
          {offline ? "Offline demo" : "Nerdy school"}
        </p>
        <h1 className="mt-1 font-heading text-xl font-medium tracking-[-0.02em]">{area.title}</h1>
        <p className="mt-0.5 text-xs text-white/60">{area.sub}</p>
      </div>

      {/* top-right: back + sound state */}
      <div className="absolute right-4 top-4 flex gap-2">
        <Link
          href="/"
          className="flex h-10 items-center gap-2 border border-white/15 bg-black/55 px-4 text-sm font-medium hover:bg-black/80"
        >
          <ArrowLeft className="h-4 w-4" /> Workspace
        </Link>
      </div>

      {/* crosshair */}
      {started && !panel ? <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 bg-white/80" /> : null}

      {/* interaction prompt */}
      {started && prompt && !panel ? (
        <button
          type="button"
          onClick={() => gameRef.current?.interact()}
          className="absolute bottom-24 left-1/2 flex -translate-x-1/2 items-center gap-2 border border-[#7bc79a] bg-black/70 px-5 py-3 text-sm font-medium text-white hover:bg-black/90"
        >
          <DoorOpen className="h-4 w-4 text-[#7bc79a]" />
          {prompt.label}
          <kbd className="border border-white/25 bg-white/10 px-2 py-0.5 font-mono text-xs">E</kbd>
        </button>
      ) : null}

      {/* mouse-capture hint */}
      {started && !locked ? (
        <p className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[11px] text-white/50">
          Click the world to look around · WASD to walk · Shift to run
        </p>
      ) : null}

      {/* classroom desk panel */}
      {panel ? (
        <aside className="absolute bottom-0 right-0 top-0 w-full max-w-md overflow-y-auto border-l border-white/15 bg-[#0b1015]/95 p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#7bc79a]">Classroom desk</p>
              <h2 className="mt-1 font-heading text-2xl font-medium tracking-[-0.02em]">{panel.course.title}</h2>
            </div>
            <button
              type="button"
              onClick={closePanel}
              className="flex h-9 w-9 items-center justify-center border border-white/15 hover:bg-white/10"
              aria-label="Close panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <h3 className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-white/50">
            Notebooks · {panel.course.notebooks.length}
          </h3>
          {panel.course.notebooks.length === 0 ? (
            <p className="mt-2 text-sm text-white/60">No notebooks yet — the shelf is empty.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {panel.course.notebooks.map((n) => (
                <li key={n.id}>
                  <a
                    href={`/courses/${panel.course.id}/notebooks/${n.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex items-center gap-3 border border-white/12 bg-white/[0.03] px-4 py-3 hover:border-[#7bc79a]/60"
                  >
                    <span className="h-2.5 w-2.5 shrink-0" style={{ backgroundColor: panel.course.color }} />
                    <span className="min-w-0 flex-1 truncate text-sm">{n.title}</span>
                    <BookOpen className="h-4 w-4 shrink-0 text-white/40 group-hover:text-[#7bc79a]" />
                  </a>
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-white/50">Progress</h3>
          {!panel.stats ? (
            <p className="mt-2 text-sm text-white/60">No practice data yet.</p>
          ) : (
            <div className="mt-2 border border-white/12">
              {[
                ["Quiz attempts", panel.stats.attempts],
                ["Cards reviewed", panel.stats.reviews],
                ["Sources ready", panel.stats.sourcesReady],
              ].map(([label, v]) => (
                <div key={label as string} className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 text-sm last:border-0">
                  <span className="text-white/60">{label}</span>
                  <span className="font-heading text-lg">{v}</span>
                </div>
              ))}
              {panel.stats.topics.map((t) => (
                <div key={t.key} className="border-b border-white/10 px-4 py-2.5 last:border-0">
                  <div className="flex items-center justify-between text-sm">
                    <span>{t.label}</span>
                    <span className="font-mono text-xs text-[#7bc79a]">{Math.round(t.score * 100)}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 bg-white/10">
                    <div className="h-full bg-[#2d6a4f]" style={{ width: `${Math.round(t.score * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <a
            href={`/courses/${panel.course.id}`}
            target="_blank"
            rel="noreferrer"
            className="mt-6 flex h-11 items-center justify-center gap-2 bg-[#2d6a4f] text-sm font-medium text-white hover:bg-[#24563f]"
          >
            Open full course <ArrowLeft className="h-4 w-4 rotate-180" />
          </a>
          <p className="mt-3 font-mono text-[11px] text-white/40">Links open in a new tab — the game keeps running.</p>
        </aside>
      ) : null}

      {/* start overlay */}
      {!started && !failed ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/70 p-6 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#7bc79a]">
            {data ? (offline ? "Offline demo school" : "Your school, built from your courses") : "Building the school…"}
          </p>
          <h1 className="mt-3 font-heading text-5xl font-medium tracking-[-0.04em]">
            {data ? `${courseCount} classrooms` : "Loading"}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-white/60">
            Walk the corridor. Each door is one of your courses — step inside to find your notebooks,
            material, quizzes and progress on the shelves and boards.
          </p>
          <button
            type="button"
            onClick={start}
            disabled={!data}
            className="mt-6 flex h-12 items-center gap-2 bg-[#2d6a4f] px-8 text-[15px] font-medium text-white hover:bg-[#24563f] disabled:opacity-40"
          >
            <DoorOpen className="h-5 w-5" /> Enter the school
          </button>
          <div className="mt-5 flex gap-2 font-mono text-xs text-white/50">
            <span className="border border-white/15 px-2.5 py-1.5">WASD walk</span>
            <span className="border border-white/15 px-2.5 py-1.5">Mouse look</span>
            <span className="border border-white/15 px-2.5 py-1.5">E interact</span>
            <span className="border border-white/15 px-2.5 py-1.5">Shift run</span>
          </div>
        </div>
      ) : null}

      {failed ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 p-6 text-center">
          <p className="max-w-sm text-sm leading-6 text-white/70">
            The 3D school could not start (WebGL unavailable). Your workspace is untouched —{" "}
            <Link href="/" className="text-[#7bc79a] underline">
              back to workspace
            </Link>
            .
          </p>
        </div>
      ) : null}
    </div>
  );
}
