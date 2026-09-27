 "use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, DoorOpen, MessageCircle } from "lucide-react";

import "./school-game.css";
import { ClassroomPanelView } from "./ClassroomPanel";
import { loadSchoolData } from "./data";
import { SchoolGame } from "./game";
import type { ClassroomPanel, SchoolData } from "./types";

export function SchoolGameView() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<SchoolGame | null>(null);
  const [data, setData] = useState<SchoolData | null>(null);
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);
  const [prompt, setPrompt] = useState<{ label: string; kind: "door" | "desk" | "exit" | "professor" } | null>(null);
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
      // Renderer creation is an imperative external-system failure.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
    <div className="school-game fixed inset-0 z-40 bg-[#05090d] font-body text-white">
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
      <div className="pointer-events-none absolute left-5 top-5 rounded-2xl border border-white/15 bg-slate-950/70 px-5 py-4 backdrop-blur-xl">
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
          className="rounded-xl backdrop-blur-xl flex h-10 items-center gap-2 border border-white/15 bg-black/55 px-4 text-sm font-medium hover:bg-black/80"
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
          className="absolute bottom-32 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-[#7bc79a] bg-slate-950/90 shadow-lg px-5 py-3 text-sm font-medium text-white hover:bg-black/90"
        >
          {prompt.kind === "professor" ? (
            <MessageCircle className="h-4 w-4 text-[#7bc79a]" />
          ) : (
            <DoorOpen className="h-4 w-4 text-[#7bc79a]" />
          )}
          {prompt.label}
          <kbd className="border border-white/25 bg-white/10 px-2 py-0.5 font-mono text-xs">E</kbd>
        </button>
      ) : null}

      {/* mouse-capture hint */}
      {started && !locked && !panel ? (
        <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[11px] text-white/50">
          Click the world to look around · WASD to walk · Shift to run
        </p>
      ) : null}

      {panel ? <ClassroomPanelView key={`${panel.course.id}:${panel.station}`} panel={panel} offline={offline} onClose={closePanel} /> : null}


      {/* start overlay */}
      {!started && !failed ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center school-welcome p-6 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#7bc79a]">
            {data ? (offline ? "Offline demo school" : "Your school, built from your courses") : "Building the school…"}
          </p>
          <h1 className="mt-3 max-w-2xl font-heading text-5xl font-medium tracking-[-0.04em]">
            {data ? "Learning, with a little adventure." : "Loading"}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-white/60">
            Explore {courseCount} classrooms. Each door is one of your courses — step inside to find your notebooks,
            material, quizzes and progress on the shelves and boards.
          </p>
          <button
            type="button"
            onClick={start}
            disabled={!data}
            className="rounded-2xl shadow-xl shadow-emerald-950/40 mt-6 flex h-12 items-center gap-2 bg-[#2d6a4f] px-8 text-[15px] font-medium text-white hover:bg-[#24563f] disabled:opacity-40"
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
