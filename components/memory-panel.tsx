"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { AlertCircle, Brain, CheckCircle2, LoaderCircle, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type SyncStatus = "pending" | "synced" | "failed";

type ProfileState = {
  profile: { static: string[]; dynamic: string[] };
  profileUsed: boolean;
  stale: boolean;
  fetchedAt: string | null;
  updating: boolean;
  sync: { synced: number; pending: number; failed: number; lastSyncedAt: string | null };
  events: Array<{
    id: string;
    kind: string;
    topicKey: string | null;
    syncStatus: SyncStatus;
    syncError: string | null;
    createdAt: string;
  }>;
  mastery: Array<{
    topicKey: string;
    label: string;
    displayLabel: string;
    score: number;
    evidenceCount: number;
    lastPracticedAt: string | null;
  }>;
  misconceptions: Array<{
    id: string;
    topicKey: string;
    claim: string;
    correction: string;
    evidenceCount: number;
  }>;
};

/**
 * Ticket 06 learner-memory panel. Shows the last confirmed remote
 * (Supermemory) profile next to the local evidence — recent learning events
 * with their sync status, deterministic topic mastery, and active
 * misconceptions — so the two are never confused. Sharp, green, hairlined
 * per DESIGN.md.
 */
export function MemoryPanel({ courseId }: { courseId: string }) {
  const [state, setState] = useState<ProfileState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preference, setPreference] = useState("");
  const [savingPreference, setSavingPreference] = useState(false);
  const [preferenceNotice, setPreferenceNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/profile?courseId=${encodeURIComponent(courseId)}`, { cache: "no-store" });
      const payload = (await response.json()) as ProfileState & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The learner profile could not be loaded.");
      setState(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The learner profile could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  // Remounts per course (see the parent key), so one load per course and no
  // reset effect. Every setState runs in the async continuation.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const savePreference = async (event: FormEvent) => {
    event.preventDefault();
    const text = preference.trim();
    if (!text || savingPreference) return;
    setSavingPreference(true);
    setPreferenceNotice(null);
    try {
      const response = await fetch("/api/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId, text }),
      });
      const payload = (await response.json()) as { error?: string; memorySync?: SyncStatus };
      if (!response.ok) throw new Error(payload.error ?? "The preference could not be saved.");
      setPreference("");
      setPreferenceNotice(
        payload.memorySync === "synced"
          ? "Preference saved and sent to memory."
          : "Preference saved locally — memory sync will retry.",
      );
      await load();
    } catch (saveError) {
      setPreferenceNotice(saveError instanceof Error ? saveError.message : "The preference could not be saved.");
    } finally {
      setSavingPreference(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
        <div>
          <p className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-blue">
            <Brain className="h-3.5 w-3.5" /> Learner memory
          </p>
          <h2 className="mt-1 font-heading text-lg font-medium tracking-[-0.02em] text-text">
            What the course remembers
          </h2>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      <CardContent className="space-y-5 px-5 py-4">
        {loading && !state ? (
          <p className="flex items-center gap-2 py-6 font-body text-sm text-text-muted">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Loading learner memory
          </p>
        ) : error && !state ? (
          <div className="flex flex-wrap items-center gap-2 border border-[#f2d1cf] bg-[#fff4f3] p-3">
            <AlertCircle className="h-4 w-4 shrink-0 text-[#93443d]" />
            <p className="flex-1 font-body text-xs leading-5 text-[#93443d]">{error}</p>
            <Button type="button" variant="danger" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          </div>
        ) : state ? (
          <>
            <SyncStrip state={state} onRetry={() => void load()} loading={loading} />

            <section aria-label="Remote profile">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
                  Last confirmed remote profile
                </p>
                {state.stale ? (
                  <Badge className="border-[#f2d1cf] bg-[#fff4f3] text-[#a53f34]">Stale snapshot</Badge>
                ) : (
                  <Badge className="border-blue/25 bg-blue-tint text-blue">Live</Badge>
                )}
              </div>
              {state.profile.static.length + state.profile.dynamic.length === 0 ? (
                <p className="mt-2 border border-dashed border-border-strong px-3 py-2.5 font-body text-xs leading-5 text-text-muted">
                  No remote profile yet. Answer a quiz or rate a flashcard — the memory syncs, then the profile fills in here.
                </p>
              ) : (
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div className="border border-border bg-white px-3 py-2.5">
                    <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-blue">Stable</p>
                    <ul className="mt-1.5 space-y-1">
                      {state.profile.static.map((fact) => (
                        <li key={`static-${fact}`} className="font-body text-xs leading-5 text-text">{fact}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="border border-border bg-white px-3 py-2.5">
                    <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-blue">Recent</p>
                    <ul className="mt-1.5 space-y-1">
                      {state.profile.dynamic.map((fact) => (
                        <li key={`dynamic-${fact}`} className="font-body text-xs leading-5 text-text">{fact}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </section>

            <section aria-label="Topic mastery">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
                Topic mastery · local
              </p>
              {state.mastery.length === 0 ? (
                <p className="mt-2 border border-dashed border-border-strong px-3 py-2.5 font-body text-xs leading-5 text-text-muted">
                  No practice evidence yet. Mastery labels appear after two evidence items on a topic.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {state.mastery.map((entry) => (
                    <li key={entry.topicKey} className="border border-border bg-white px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] font-medium text-text">{entry.topicKey}</span>
                        <Badge className={cn(entry.displayLabel === "Not enough evidence" && "border-border-strong bg-paper text-text-muted")}>
                          {entry.displayLabel}
                        </Badge>
                        <span className="ml-auto font-mono text-[11px] text-text-dim">
                          {Math.round(entry.score * 100)}% · {entry.evidenceCount} evidence
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 w-full bg-paper" aria-hidden="true">
                        <div className="h-1.5 bg-blue" style={{ width: `${Math.round(entry.score * 100)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-label="Misconceptions">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
                Misconceptions · local
              </p>
              {state.misconceptions.length === 0 ? (
                <p className="mt-2 border border-dashed border-border-strong px-3 py-2.5 font-body text-xs leading-5 text-text-muted">
                  None recorded. A wrong quiz answer creates one here immediately.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {state.misconceptions.map((item) => (
                    <li key={item.id} className="border border-border bg-white px-3 py-2.5">
                      <p className="font-body text-xs font-semibold leading-5 text-text">
                        {item.claim}
                        <span className="ml-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
                          {item.topicKey} · ×{item.evidenceCount}
                        </span>
                      </p>
                      <p className="mt-1 font-body text-xs leading-5 text-text-muted">{item.correction}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-label="Local learning events">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
                Local learning events
              </p>
              {state.events.length === 0 ? (
                <p className="mt-2 border border-dashed border-border-strong px-3 py-2.5 font-body text-xs leading-5 text-text-muted">
                  Nothing recorded yet for this course.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {state.events.map((event) => (
                    <li key={event.id} className="flex flex-wrap items-center gap-2 border border-border bg-paper px-3 py-2">
                      <span className="font-mono text-[11px] font-medium text-text">{EVENT_LABEL[event.kind] ?? event.kind}</span>
                      {event.topicKey ? (
                        <span className="font-mono text-[11px] text-text-dim">{event.topicKey}</span>
                      ) : null}
                      <span className="ml-auto">
                        <SyncBadge status={event.syncStatus} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-label="Study preference">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
                Tell memory a preference
              </p>
              <form onSubmit={savePreference} className="mt-2 flex gap-2">
                <Input
                  value={preference}
                  onChange={(event) => setPreference(event.target.value)}
                  placeholder="e.g. Explain with short examples first"
                  aria-label="Study preference"
                  disabled={savingPreference}
                  maxLength={280}
                />
                <Button type="submit" disabled={savingPreference || !preference.trim()}>
                  {savingPreference ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                  Save
                </Button>
              </form>
              {preferenceNotice ? (
                <p className="mt-2 border border-blue/25 bg-blue-tint px-3 py-2 font-body text-xs leading-5 text-blue">
                  {preferenceNotice}
                </p>
              ) : null}
            </section>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

const EVENT_LABEL: Record<string, string> = {
  quiz_answer: "Quiz answer",
  quiz_complete: "Quiz complete",
  flashcard_review: "Flashcard review",
  misconception: "Misconception",
  preference: "Preference",
  study_complete: "Study complete",
};

function SyncStrip({ state, onRetry, loading }: { state: ProfileState; onRetry: () => void; loading: boolean }) {
  if (state.sync.failed > 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 border border-[#f2d1cf] bg-[#fff4f3] p-3">
        <AlertCircle className="h-4 w-4 shrink-0 text-[#93443d]" />
        <p className="flex-1 font-body text-xs leading-5 text-[#93443d]">
          {state.sync.failed} memory sync{state.sync.failed === 1 ? "" : "s"} failed. Quiz and flashcard state is kept — retry sends the same events again without duplicates.
        </p>
        <Button type="button" variant="danger" size="sm" onClick={onRetry} disabled={loading}>
          {loading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Retry sync
        </Button>
      </div>
    );
  }
  if (state.updating) {
    return (
      <div className="flex flex-wrap items-center gap-2 border border-blue/25 bg-blue-tint p-3">
        <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-blue" />
        <p className="flex-1 font-body text-xs leading-5 text-blue">
          Memory is updating — {state.sync.pending} local event{state.sync.pending === 1 ? "" : "s"} still syncing. Local state below is already current.
        </p>
      </div>
    );
  }
  if (state.sync.synced > 0) {
    return (
      <div className="flex flex-wrap items-center gap-2 border border-border bg-paper p-3">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-blue" />
        <p className="flex-1 font-body text-xs leading-5 text-text-muted">
          Memory is in sync — {state.sync.synced} event{state.sync.synced === 1 ? "" : "s"} confirmed by Supermemory.
        </p>
      </div>
    );
  }
  return null;
}

function SyncBadge({ status }: { status: SyncStatus }) {
  if (status === "synced") {
    return <Badge className="border-blue/25 bg-blue-tint text-blue">Synced</Badge>;
  }
  if (status === "failed") {
    return <Badge className="border-[#f2d1cf] bg-[#fff4f3] text-[#a53f34]">Sync failed</Badge>;
  }
  return <Badge>Sync pending</Badge>;
}
