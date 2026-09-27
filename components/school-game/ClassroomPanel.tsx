"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, BookOpen, Layers, Play, Search, X } from "lucide-react";
import type { CourseArtifactSummary } from "@/app/api/course-artifacts/route";
import type { ClassroomPanel as Panel, Station } from "./types";

export function ClassroomPanelView({ panel, offline, onClose }: { panel: Panel; offline: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Station>(panel.station ?? "notebooks");
  const [query, setQuery] = useState("");
  const [artifacts, setArtifacts] = useState<CourseArtifactSummary[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const controller = new AbortController();
    if (offline) return;
    fetch(`/api/course-artifacts?courseId=${encodeURIComponent(panel.course.id)}`, { signal: controller.signal, cache: "no-store" })
      .then(async r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { setArtifacts(d.artifacts ?? []); setState("ready"); })
      .catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [panel.course.id, offline]);
  const rows = tab === "notebooks" ? panel.course.notebooks.map(n => ({ id: n.id, title: n.title, url: `/courses/${panel.course.id}/notebooks/${n.id}`, detail: "Notebook · open your notes" })) : artifacts.filter(a => tab === "videos" ? a.kind === "video" : a.kind !== "video").map(a => ({ ...a, detail: a.status !== "ready" ? a.status : a.kind === "video" ? "Video lesson" : a.kind === "assessment" ? `${a.questionCount ?? 0} questions` : `${a.cardCount ?? 0} flashcards` }));
  const filtered = rows.filter(r => r.title.toLowerCase().includes(query.toLowerCase()));
  return <aside role="dialog" aria-modal="true" aria-label={`${panel.course.title} classroom`} className="school-panel">
    <div className="flex items-start justify-between gap-4"><div><p className="school-eyebrow">YOUR LEARNING SPACE</p><h2 className="mt-2 text-3xl font-semibold tracking-tight">{panel.course.title}</h2><p className="mt-2 text-sm text-slate-400">A little exploration. A lot of discovery.</p></div><button autoFocus onClick={onClose} aria-label="Close classroom panel" className="school-icon"><X size={18} /></button></div>
    <div className="my-6 grid grid-cols-3 gap-2">{[["Notebooks", panel.course.notebooks.length], ["Quiz attempts", panel.stats?.attempts ?? "—"], ["Cards reviewed", panel.stats?.reviews ?? "—"]].map(([name, value]) => <div key={name} className="rounded-2xl border border-white/10 bg-white/5 p-3"><strong className="text-2xl text-emerald-200">{value}</strong><p className="mt-1 text-[10px] text-slate-400">{name}</p></div>)}</div>
    <div className="flex gap-1 rounded-2xl bg-black/25 p-1" role="tablist" aria-label="Classroom stations">{([["notebooks", "Library", BookOpen], ["practice", "Practice", Layers], ["videos", "Cinema", Play]] as const).map(([id, label, Icon]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => { setTab(id); setQuery(""); }} className={`flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-xs ${tab === id ? "bg-emerald-200 text-slate-950" : "text-slate-400 hover:text-white"}`}><Icon size={15} />{label}</button>)}</div>
    <label className="my-4 flex items-center gap-2 rounded-xl border border-white/10 px-3"><Search size={16} className="text-slate-500"/><input aria-label="Search classroom resources" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find something to learn…" className="w-full bg-transparent py-3 text-sm outline-none" /></label>
    <div role="tabpanel" className="space-y-2">
      {tab !== "notebooks" && !offline && state === "loading" ? <p className="school-empty">Loading your learning collection…</p> : tab !== "notebooks" && !offline && state === "error" ? <p className="school-empty">Couldn’t load this collection. Close and reopen the station to try again.</p> : filtered.length ? filtered.map(row => offline ? <div key={row.id} className="school-resource"><BookOpen size={20}/><div><p>{row.title}</p><small>Demo notebook</small></div></div> : <a className="school-resource" key={row.id} href={row.url} target="_blank" rel="noreferrer"><span className="school-resource-icon">{tab === "videos" ? <Play size={19}/> : tab === "practice" ? <Layers size={19}/> : <BookOpen size={19}/>}</span><div className="min-w-0 flex-1"><p className="truncate text-sm">{row.title}</p><small>{row.detail}</small></div><ArrowUpRight size={16}/></a>) : <p className="school-empty">{query ? "No matches. Try another title." : offline ? "Demo room — connect your courses to find your learning resources here." : tab === "notebooks" ? "Your shelf is ready for its first notebook." : "Create quizzes, flashcards, or videos in course chat and find them here. Notebook activities live inside their notebooks."}</p>}
    </div>
    {!!panel.stats?.topics.length && <div className="mt-7"><p className="school-eyebrow">TOPIC PROGRESS</p>{panel.stats.topics.map(t => <div key={t.key} className="mt-4"><div className="flex justify-between text-xs"><span>{t.label}</span><span className="text-emerald-200">{Math.round(t.score * 100)}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-emerald-300" style={{ width: `${Math.max(0, Math.min(100, t.score * 100))}%` }}/></div></div>)}</div>}
    {!offline && <a href={`/courses/${panel.course.id}`} target="_blank" rel="noreferrer" className="mt-7 flex items-center justify-between rounded-xl border border-white/15 p-4 text-sm hover:bg-white/5">Open course · materials & creation <ArrowUpRight size={17}/></a>}
    <p className="mt-4 text-xs leading-5 text-slate-500">Resources open in a new tab. Your character stays here. Press Esc to return to the room.</p>
  </aside>;
}
