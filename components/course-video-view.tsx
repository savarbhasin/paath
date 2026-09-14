"use client";
import { ManageItemButton } from "@/components/manage-item-button";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Clapperboard, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { videoPayloadSchema, type VideoPayload } from "@/lib/video";
import { cn } from "@/lib/utils";

type VideoDetail = {
  artifact: { id: string; status: string; payload: unknown };
  videoUrl: string | null;
  captionsUrl: string | null;
};

const STAGE_STEPS = [
  { stage: "queued", label: "Queued" },
  { stage: "writing_script", label: "Writing script" },
  { stage: "creating_visuals", label: "Creating visuals" },
  { stage: "rendering", label: "Rendering" },
  { stage: "ready", label: "Ready" },
] as const;

const POLL_INTERVAL_MS = 5000;
const URL_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function isPendingDetail(detail: VideoDetail | null, payload: VideoPayload | null): boolean {
  if (!detail) return true;
  if (detail.artifact.status === "pending" || detail.artifact.status === "generating") return true;
  if (!payload) return false;
  return payload.stage !== "ready" && payload.stage !== "failed";
}

function formatDuration(totalSeconds: number | undefined): string | null {
  if (typeof totalSeconds !== "number" || !Number.isFinite(totalSeconds) || totalSeconds < 0) return null;
  const rounded = Math.round(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function openSourceById(sourceId: string): Promise<void> {
  const response = await fetch(`/api/sources/${sourceId}/open`, { cache: "no-store" });
  const data = (await response.json()) as { url?: string; error?: string };
  if (!response.ok || !data.url) throw new Error(data.error ?? "The source could not be opened.");
  window.open(data.url, "_blank", "noopener,noreferrer");
}

/**
 * Course-level teaching video view. Shows generation progress
 * (Queued → Writing script → Creating visuals → Rendering → Ready), the
 * ready MP4 with captions/transcript/citations, or the actual failure with
 * an explicit retry. Pending detail polls; signed playback URLs refresh
 * silently; a failed refresh never discards the last good data.
 */
export function CourseVideoView({ courseId, artifactId }: { courseId: string; artifactId: string }) {
  const [detail, setDetail] = useState<VideoDetail | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadKey, setLoadKey] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);

  const load = useCallback(async (signal: AbortSignal, silent: boolean) => {
    try {
      const response = await fetch(`/api/videos/${artifactId}?courseId=${courseId}`, {
        cache: "no-store",
        signal,
      });
      const payload = (await response.json()) as { artifact?: VideoDetail["artifact"]; videoUrl?: unknown; captionsUrl?: unknown; error?: string };
      if (signal.aborted) return;
      if (!response.ok || !payload.artifact) {
        throw new Error(payload.error ?? "The video could not be loaded.");
      }
      setDetail({
        artifact: payload.artifact,
        videoUrl: typeof payload.videoUrl === "string" ? payload.videoUrl : null,
        captionsUrl: typeof payload.captionsUrl === "string" ? payload.captionsUrl : null,
      });
      // Any successful load — silent poll or not — clears a stale notice.
      setNotice(null);
    } catch (error) {
      if (signal.aborted) return;
      // Keep the last good data on refresh failures; only surface a notice.
      setNotice(error instanceof Error ? error.message : "The video could not be loaded.");
    } finally {
      if (!signal.aborted && !silent) setLoadKey(`${courseId}:${artifactId}`);
    }
  }, [courseId, artifactId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal, false), 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [courseId, artifactId, reloadKey, load]);

  const parsed = detail ? videoPayloadSchema.safeParse(detail.artifact.payload) : null;
  const video: VideoPayload | null = parsed && parsed.success ? parsed.data : null;
  const pending = isPendingDetail(detail, video);
  const failed = detail !== null && (detail.artifact.status === "failed" || video?.stage === "failed");
  const ready = video?.stage === "ready" && detail?.artifact.status === "ready";

  useEffect(() => {
    if (!detail || !pending) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => void load(controller.signal, true), POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [detail, pending, load]);

  // Signed playback URLs expire; renew them quietly while the player is open.
  useEffect(() => {
    if (!detail || pending || !ready || !detail.videoUrl) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => void load(controller.signal, true), URL_REFRESH_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [detail, pending, ready, load]);

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      const response = await fetch(`/api/videos/${artifactId}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The video could not be retried.");
      const controller = new AbortController();
      await load(controller.signal, true);
      // Tell the sidebar to reload so the failed row restarts its polling.
      window.dispatchEvent(new CustomEvent("course-artifacts-updated", { detail: { courseId } }));
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : "The video could not be retried.");
    } finally {
      setRetrying(false);
    }
  };

  const handleOpenSource = async (sourceId: string) => {
    setOpeningId(sourceId);
    setSourceError(null);
    try {
      await openSourceById(sourceId);
    } catch (error) {
      setSourceError(error instanceof Error ? error.message : "The source could not be opened.");
    } finally {
      setOpeningId(null);
    }
  };

  const loading = loadKey !== `${courseId}:${artifactId}`;
  const duration = formatDuration(video?.durationSeconds);
  const failureMessage = video?.error ?? null;

  return (
    <main className="min-h-screen bg-bg font-body text-text">
      <div className="mb-6 flex items-center justify-between gap-3 px-4 pt-3">
        <Link href={`/courses/${courseId}`} className="pressable font-body text-xs font-medium text-blue hover:underline">
          ← Back to course
        </Link>
        {detail ? <ManageItemButton id={artifactId} courseId={courseId} kind="artifact" title={video?.title ?? "Video"} showLabel /> : null}
      </div>
      <section className="mx-auto w-full max-w-5xl px-4 pb-6">
        {loading && !detail ? (
          <p className="mt-6 flex items-center gap-2 font-body text-sm text-text-muted">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Loading video
          </p>
        ) : !detail ? (
          <div className="mt-6 border border-dashed border-border-strong px-6 py-12 text-center">
            <h1 className="font-heading text-xl font-medium tracking-[-0.02em] text-text">Video not found</h1>
            <p className="mx-auto mt-2 max-w-sm font-body text-sm leading-6 text-text-muted">
              {notice ?? "It may have been removed. Ask the course chat to create a new one."}
            </p>
            <div className="mt-5">
              <Button type="button" variant="outline" size="sm" onClick={() => setReloadKey((current) => current + 1)}>
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </Button>
            </div>
          </div>
        ) : !video ? (
          <div className="mt-6 border border-dashed border-border-strong px-6 py-12 text-center">
            <h1 className="font-heading text-xl font-medium tracking-[-0.02em] text-text">Video needs regeneration</h1>
            <p className="mx-auto mt-2 max-w-sm font-body text-sm leading-6 text-text-muted">
              This video came back malformed, so nothing usable was kept. Ask the course chat to generate it again.
            </p>
          </div>
        ) : (
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-blue">
                <Clapperboard className="h-3.5 w-3.5" /> Video
              </span>
              {ready ? (
                <Badge className="border-blue/25 bg-blue-tint text-blue">Ready{duration ? ` · ${duration}` : ""}</Badge>
              ) : failed ? (
                <Badge className="border-[#f2d1cf] bg-[#fff4f3] text-[#a53f34]">Failed</Badge>
              ) : (
                <Badge className="border-border bg-paper text-text-muted">
                  {pending ? "Generating" : detail.artifact.status}
                </Badge>
              )}
            </div>
            <h1 className="mt-2 font-heading text-base font-medium tracking-[-0.01em] text-text">{video.title}</h1>
            <p className="mt-0.5 font-body text-sm text-text-muted">{video.topic}</p>

            {notice && detail ? (
              <p role="status" className="mt-2 font-body text-xs text-text-dim">
                Live update failed ({notice}); showing the last saved state.
              </p>
            ) : null}

            {!ready && !failed ? (
              <div className="mt-4 border border-border bg-white p-4">
                <p className="flex items-center gap-2 font-body text-sm text-text-muted">
                  <LoaderCircle className="h-4 w-4 animate-spin" /> Generating your video — this stays saved if you leave.
                </p>
                <ol className="mt-3 space-y-1.5" aria-label="Video progress">
                  {STAGE_STEPS.map((step) => {
                    const order = ["queued", "writing_script", "creating_visuals", "rendering", "ready"];
                    const currentIndex = order.indexOf(video.stage);
                    const stepIndex = order.indexOf(step.stage);
                    const done = stepIndex < currentIndex;
                    const current = stepIndex === currentIndex;
                    return (
                      <li key={step.stage} className="flex items-center gap-2 font-body text-[13px]">
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex h-4 w-4 items-center justify-center rounded-full border font-mono text-[10px]",
                            done && "border-blue bg-blue text-white",
                            current && "border-blue text-blue",
                            !done && !current && "border-border text-text-dim",
                          )}
                        >
                          {done ? "✓" : stepIndex + 1}
                        </span>
                        <span className={current ? "font-medium text-text" : done ? "text-text" : "text-text-dim"}>
                          {step.label}
                        </span>
                        {current ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-text-dim" /> : null}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ) : null}

            {failed ? (
              <div className="mt-4 border border-[#f2d1cf] bg-[#fff4f3] p-4">
                <p className="flex items-start gap-2 font-body text-sm leading-6 text-[#93443d]">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    This video failed{failureMessage ? `: ${failureMessage}` : "."} Your course materials are unchanged.
                  </span>
                </p>
                <div className="mt-3">
                  <Button type="button" variant="danger" size="sm" disabled={retrying} onClick={() => void retry()}>
                    {retrying ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Retry video
                  </Button>
                </div>
                {retryError ? <p role="alert" className="mt-2 font-body text-xs text-[#a53f34]">{retryError}</p> : null}
              </div>
            ) : null}

            {ready && detail.videoUrl ? (
              <div className="mt-4">
                <video controls preload="metadata" crossOrigin="anonymous" src={detail.videoUrl} className="aspect-video w-full border border-border bg-black">
                  {detail.captionsUrl ? (
                    <track kind="captions" src={detail.captionsUrl} srcLang="en" label="English" default />
                  ) : null}
                  Your browser cannot play this video.
                </video>
                <p className="mt-1.5 font-body text-xs text-text-dim">
                  AI-generated narration{duration ? ` · ${duration}` : ""}{detail.captionsUrl ? " · captions available" : ""}
                </p>
              </div>
            ) : null}

            {ready && !detail.videoUrl ? (
              <div className="mt-4 border border-[#f2d1cf] bg-[#fff4f3] p-4">
                <p className="font-body text-sm leading-6 text-[#93443d]">
                  The video is marked ready but no playback URL was issued. Reload the page; if this persists, retry below.
                </p>
                <div className="mt-3">
                  <Button type="button" variant="danger" size="sm" disabled={retrying} onClick={() => void retry()}>
                    {retrying ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Retry video
                  </Button>
                </div>
                {retryError ? <p role="alert" className="mt-2 font-body text-xs text-[#a53f34]">{retryError}</p> : null}
              </div>
            ) : null}

            {video.transcript ? (
              <section aria-label="Transcript" className="mt-5 border-t border-border pt-4">
                <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">Transcript</h2>
                <p className="mt-2 whitespace-pre-wrap font-body text-sm leading-6 text-text">{video.transcript}</p>
              </section>
            ) : null}

            {video.citations && video.citations.length > 0 ? (
              <section aria-label="Sources" className="mt-5 border-t border-border pt-4">
                <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">Sources</h2>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {video.citations.map((citation) => (
                    <Button
                      key={citation.sourceId}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={openingId === citation.sourceId}
                      onClick={() => void handleOpenSource(citation.sourceId)}
                    >
                      {openingId === citation.sourceId ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ExternalLink className="h-3.5 w-3.5" />
                      )}
                      {citation.title}
                    </Button>
                  ))}
                </div>
                {sourceError ? <p role="alert" className="mt-2 font-body text-xs text-[#a53f34]">{sourceError}</p> : null}
              </section>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
