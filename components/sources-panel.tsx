"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  ExternalLink,
  FileUp,
  FileText,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  TERMINAL_SOURCE_STATUSES,
  getFileExtension,
  validateSourceFile,
  type Source,
  type SourceStatus,
} from "@/lib/sources";
import { cn } from "@/lib/utils";

type SourcesResponse = { sources: Source[] } | { error: string };
type SignResponse =
  | { source: Source; storagePath: string; signedUrl: string; token: string }
  | { error: string };
type StatusResponse =
  | { source: Source; providerStatus: string | null; diagnostic: { code: string; message: string } | null }
  | { error: string };
type RetryResponse =
  | { source: Source; storagePath?: string; signedUrl?: string; token?: string }
  | { error: string };
type OpenResponse = { url: string; kind: string; source: Source } | { error: string };

const STATUS_COPY: Record<SourceStatus, string> = {
  uploading: "Uploading",
  queued: "Queued",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
  retrying: "Retrying",
};

function putFile(url: string, file: File, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", file.type || "application/pdf");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`The upload failed with status ${xhr.status}.`));
    };
    xhr.onerror = () => reject(new Error("The upload failed before it finished."));
    xhr.send(file);
  });
}

export function SourcesPanel({ courseId }: { courseId: string }) {
  const deletedSourceIds = useRef(new Set<string>());
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Source[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Record<string, string>>({});
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [reuploadFor, setReuploadFor] = useState<string | null>(null);
  const [pendingUploadToken, setPendingUploadToken] = useState<{ signedUrl: string; token: string } | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeTitle, setYoutubeTitle] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [sourceKind, setSourceKind] = useState<"pdf" | "youtube">("pdf");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogHeadingId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reuploadInputRef = useRef<HTMLInputElement>(null);

  const upsertSource = useCallback((next: Source) => {
    if (deletedSourceIds.current.has(next.id)) return;
    setSources((current) => {
      const exists = current.some((source) => source.id === next.id);
      if (!exists) return [...current, next];
      return current.map((source) => (source.id === next.id ? next : source));
    });
  }, []);

  const loadSources = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/sources?courseId=${encodeURIComponent(courseId)}`, { cache: "no-store" });
      const payload = (await response.json()) as SourcesResponse;
      if (!response.ok || !("sources" in payload)) {
        throw new Error("error" in payload ? payload.error : "Sources could not be loaded.");
      }
      setSources(payload.sources.filter((source) => !deletedSourceIds.current.has(source.id)));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Sources could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadSources(), 0);
    return () => window.clearTimeout(timer);
  }, [loadSources]);

  useEffect(() => {
    if (modalOpen) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [modalOpen]);

  const closeModal = () => {
    if (isBusy) return;
    setSelectedFile(null);
    setFormError(null);
    setModalOpen(false);
  };

  const refreshStatus = useCallback(async (sourceId: string) => {
    try {
      const response = await fetch(`/api/sources/${sourceId}/status`, { cache: "no-store" });
      const payload = (await response.json()) as StatusResponse;
      if (!response.ok || !("source" in payload)) {
        throw new Error("error" in payload ? payload.error : "Status could not be read.");
      }
      upsertSource(payload.source);
      setDiagnostics((current) => {
        if (!payload.diagnostic) {
          if (!(sourceId in current)) return current;
          const next = { ...current };
          delete next[sourceId];
          return next;
        }
        return { ...current, [sourceId]: payload.diagnostic.message };
      });
    } catch {
      // Polling stays quiet; the last known state remains visible.
    }
  }, [upsertSource]);

  useEffect(() => {
    const pending = sources.filter((source) => !TERMINAL_SOURCE_STATUSES.has(source.status));
    if (pending.length === 0) return;
    const timer = window.setInterval(() => {
      for (const source of pending) void refreshStatus(source.id);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [sources, refreshStatus]);

  const confirmUpload = useCallback(async (sourceId: string) => {
    const response = await fetch(`/api/sources/${sourceId}/ingest`, { method: "POST" });
    const payload = (await response.json()) as { source?: Source; error?: string };
    if (!response.ok || !payload.source) {
      throw new Error(payload.error ?? "Ingestion could not start.");
    }
    upsertSource(payload.source);
  }, [upsertSource]);

  const handleFile = useCallback(async (file: File, existingSourceId?: string, signedUrl?: string): Promise<boolean> => {
    setFormError(null);
    setIsBusy(true);
    let activeSourceId = existingSourceId;
    try {
      const extension = getFileExtension(file.name);
      const mimeType = file.type || (extension === "pdf" ? "application/pdf" : "");
      const validation = validateSourceFile({ filename: file.name, mimeType, size: file.size });
      if (!validation.ok) {
        throw new Error(validation.reason ?? "Unsupported file.");
      }

      let sourceId = activeSourceId;
      let uploadUrl = signedUrl;
      if (!sourceId || !uploadUrl) {
        const signResponse = await fetch("/api/uploads/sign", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ courseId, filename: file.name, mimeType, size: file.size }),
        });
        const signPayload = (await signResponse.json()) as SignResponse;
        if (!signResponse.ok || !("source" in signPayload)) {
          throw new Error("error" in signPayload ? signPayload.error : "The upload could not start.");
        }
        sourceId = signPayload.source.id;
        uploadUrl = signPayload.signedUrl;
        upsertSource(signPayload.source);
        setUploadProgress((current) => ({ ...current, [signPayload.source.id]: 0 }));
      } else {
        setUploadProgress((current) => ({ ...current, [sourceId as string]: 0 }));
      }

      await putFile(uploadUrl, file, (percent) => {
        setUploadProgress((current) => ({ ...current, [sourceId as string]: percent }));
      });
      setUploadProgress((current) => {
        const next = { ...current };
        delete next[sourceId as string];
        return next;
      });
      setReuploadFor(null);
      setPendingUploadToken(null);
      await confirmUpload(sourceId);
      activeSourceId = sourceId;
      return true;
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The upload failed.");
      if (activeSourceId) void refreshStatus(activeSourceId);
      return false;
    } finally {
      setIsBusy(false);
    }
  }, [confirmUpload, courseId, refreshStatus, upsertSource]);

  const handleYoutube = useCallback(async (): Promise<boolean> => {
    if (!youtubeUrl.trim() || isBusy) return false;
    setFormError(null);
    setIsBusy(true);
    try {
      const response = await fetch("/api/sources/youtube", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId, url: youtubeUrl, title: youtubeTitle || undefined }),
      });
      const payload = (await response.json()) as { source?: Source; error?: string };
      if (!response.ok || !payload.source) {
        throw new Error(payload.error ?? "The YouTube source could not be added.");
      }
      upsertSource(payload.source);
      setYoutubeUrl("");
      setYoutubeTitle("");
      return true;
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The YouTube source could not be added.");
      return false;
    } finally {
      setIsBusy(false);
    }
  }, [courseId, isBusy, upsertSource, youtubeTitle, youtubeUrl]);

  const uploadSelected = async () => {
    if (!selectedFile) return;
    const ok = await handleFile(selectedFile);
    if (ok) {
      setSelectedFile(null);
      setModalOpen(false);
    }
  };

  const addYoutube = async () => {
    const ok = await handleYoutube();
    if (ok) setModalOpen(false);
  };

  const handleRetry = useCallback(async (source: Source) => {
    setFormError(null);
    try {
      const response = await fetch(`/api/sources/${source.id}/retry`, { method: "POST" });
      const payload = (await response.json()) as RetryResponse;
      if (!response.ok || !("source" in payload)) {
        throw new Error("error" in payload ? payload.error : "Retry could not start.");
      }
      upsertSource(payload.source);
      if (payload.signedUrl && payload.token) {
        // The file never reached storage: keep the same source id and ask
        // for the bytes again through the fresh upload token.
        setReuploadFor(payload.source.id);
        setPendingUploadToken({ signedUrl: payload.signedUrl, token: payload.token });
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Retry could not start.");
    }
  }, [upsertSource]);

  const handleDelete = useCallback(async (source: Source) => {
    setDeletingIds((current) => new Set(current).add(source.id));
    setDeleteErrors((current) => ({ ...current, [source.id]: "" }));
    try {
      const response = await fetch(`/api/sources/${source.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error ?? "The source could not be deleted.");
      }
      deletedSourceIds.current.add(source.id);
      setSources((current) => current.filter((item) => item.id !== source.id));
      if (reuploadFor === source.id) {
        setReuploadFor(null);
        setPendingUploadToken(null);
      }
    } catch (error) {
      setDeleteErrors((current) => ({ ...current, [source.id]: error instanceof Error ? error.message : "The source could not be deleted." }));
    } finally {
      setDeletingIds((current) => {
        const next = new Set(current);
        next.delete(source.id);
        return next;
      });
    }
  }, [reuploadFor]);

  const handleOpen = useCallback(async (source: Source) => {
    try {
      const response = await fetch(`/api/sources/${source.id}/open`, { cache: "no-store" });
      const payload = (await response.json()) as OpenResponse;
      if (!response.ok || !("url" in payload)) {
        throw new Error("error" in payload ? payload.error : "The source could not be opened.");
      }
      window.open(payload.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "The source could not be opened.");
    }
  }, []);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-4">
          <div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-blue">Sources</p>
            <h2 className="mt-1 font-heading text-lg font-medium tracking-[-0.02em] text-text">
              Attach what you are learning
            </h2>
            <p className="mt-1 font-body text-sm leading-6 text-text-muted">
              PDFs upload to private storage; YouTube links submit directly. Everything becomes searchable once ready.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={isBusy}
            onClick={() => {
              setFormError(null);
              setModalOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add source
          </Button>
        </div>

        <dialog
          ref={dialogRef}
          aria-labelledby={dialogHeadingId}
          className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md border border-border bg-white p-5 text-text shadow-xl backdrop:bg-black/30"
          onCancel={(event) => {
            event.preventDefault();
            closeModal();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeModal();
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <h2 id={dialogHeadingId} className="font-heading text-lg font-medium">Add source</h2>
            <button
              type="button"
              onClick={closeModal}
              disabled={isBusy}
              aria-label="Close"
              className="pressable p-1 text-text-muted hover:text-text disabled:opacity-40"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2" role="group" aria-label="Source type">
            <button
              type="button"
              aria-pressed={sourceKind === "pdf"}
              onClick={() => setSourceKind("pdf")}
              className={cn(
                "pressable flex items-center justify-center gap-2 border px-3 py-2.5 font-body text-sm font-medium transition-colors",
                sourceKind === "pdf"
                  ? "border-blue bg-blue-tint text-text"
                  : "border-border bg-white text-text-muted hover:bg-bg-alt hover:text-text",
              )}
            >
              <FileUp className="h-4 w-4" /> PDF
            </button>
            <button
              type="button"
              aria-pressed={sourceKind === "youtube"}
              onClick={() => setSourceKind("youtube")}
              className={cn(
                "pressable flex items-center justify-center gap-2 border px-3 py-2.5 font-body text-sm font-medium transition-colors",
                sourceKind === "youtube"
                  ? "border-blue bg-blue-tint text-text"
                  : "border-border bg-white text-text-muted hover:bg-bg-alt hover:text-text",
              )}
            >
              <Play className="h-4 w-4" /> YouTube
            </button>
          </div>

          {sourceKind === "pdf" ? (
            <div className="mt-4 space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                aria-label="Choose a PDF file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  setSelectedFile(file ?? null);
                }}
              />
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => fileInputRef.current?.click()}>
                  <FileUp className="h-3.5 w-3.5" /> Choose PDF
                </Button>
                <span className="min-w-0 flex-1 truncate font-body text-xs text-text-muted">
                  {selectedFile ? selectedFile.name : "No file chosen"}
                </span>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={closeModal} disabled={isBusy}>
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={() => void uploadSelected()} disabled={isBusy || !selectedFile}>
                  {isBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
                  Upload
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <Input
                value={youtubeUrl}
                onChange={(event) => setYoutubeUrl(event.target.value)}
                placeholder="Paste a public YouTube URL"
                aria-label="YouTube URL"
                disabled={isBusy}
              />
              <Input
                value={youtubeTitle}
                onChange={(event) => setYoutubeTitle(event.target.value)}
                placeholder="Video title (optional)"
                aria-label="YouTube video title"
                disabled={isBusy}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={closeModal} disabled={isBusy}>
                  Cancel
                </Button>
                <Button type="button" size="sm" onClick={() => void addYoutube()} disabled={isBusy || !youtubeUrl.trim()}>
                  {isBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  Add
                </Button>
              </div>
            </div>
          )}

          {formError ? (
            <div className="mt-4 flex items-start gap-2 border border-[#f2d1cf] bg-[#fff4f3] p-3 font-body text-xs leading-5 text-[#93443d]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          ) : null}
        </dialog>

        <div className="px-5 py-4">
          {isLoading ? (
            <p className="flex items-center gap-2 py-4 font-body text-sm text-text-muted">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Loading sources
            </p>
          ) : loadError ? (
            <div className="flex flex-wrap items-center gap-3 border border-border bg-paper p-4">
              <p className="flex-1 font-body text-sm text-text-muted">{loadError}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadSources()}>
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </Button>
            </div>
          ) : sources.length === 0 ? (
            <div className="border border-dashed border-border-strong px-4 py-8 text-center">
              <FileText className="mx-auto h-6 w-6 text-text-dim" />
              <p className="mt-3 font-heading text-sm font-medium tracking-[-0.01em] text-text">No sources yet</p>
              <p className="mx-auto mt-1 max-w-xs font-body text-xs leading-5 text-text-muted">
                Upload a lecture PDF or add a captioned YouTube video. It will show up here while it becomes searchable.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border border-y border-border">
              {sources.map((source) => (
                <li key={source.id} className="flex flex-wrap items-center gap-2 px-1 py-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-border bg-paper text-blue">
                    {source.type === "youtube" ? <Play className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-body text-sm font-medium tracking-[-0.005em] text-text">{source.title}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-text-dim">
                      {source.type === "youtube" ? "YOUTUBE" : source.type.toUpperCase()} · {STATUS_COPY[source.status].toUpperCase()}
                    </p>
                    {source.status === "uploading" && uploadProgress[source.id] !== undefined ? (
                      <div className="mt-2 h-1.5 w-full max-w-56 border border-border bg-paper" role="progressbar" aria-valuenow={uploadProgress[source.id]} aria-valuemin={0} aria-valuemax={100} aria-label={`Upload progress for ${source.title}`}>
                        <div className="h-full bg-blue transition-all" style={{ width: `${uploadProgress[source.id]}%` }} />
                      </div>
                    ) : null}
                    {deleteErrors[source.id] ? <p role="alert" className="mt-1 font-body text-xs leading-5 text-[#93443d]">{deleteErrors[source.id]}</p> : null}
                    {source.error ? <p className="mt-1 font-body text-xs leading-5 text-[#93443d]">{source.error}</p> : null}
                    {diagnostics[source.id] ? <p className="mt-1 font-body text-xs leading-5 text-text-muted">{diagnostics[source.id]}</p> : null}
                    {reuploadFor === source.id ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          ref={reuploadInputRef}
                          type="file"
                          accept="application/pdf,.pdf"
                          className="hidden"
                          aria-label={`Choose the file again for ${source.title}`}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            if (file && pendingUploadToken) {
                              void handleFile(file, source.id, pendingUploadToken.signedUrl);
                            }
                          }}
                        />
                        <Button type="button" variant="outline" size="sm" onClick={() => reuploadInputRef.current?.click()}>
                          <FileUp className="h-3.5 w-3.5" /> Choose the file again
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <StatusBadge status={source.status} />
                    <button
                      type="button"
                      aria-label={`Delete ${source.title}`}
                      title="Delete"
                      disabled={isBusy || deletingIds.has(source.id)}
                      onClick={() => void handleDelete(source)}
                      className="pressable p-2 text-text-dim transition-colors hover:bg-bg-alt hover:text-[#a53f34] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {deletingIds.has(source.id) ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                    {source.status === "ready" ? (
                      <button
                        type="button"
                        aria-label={`Open ${source.title}`}
                        title="Open"
                        onClick={() => void handleOpen(source)}
                        className="pressable p-2 text-text-dim transition-colors hover:bg-bg-alt hover:text-text"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </button>
                    ) : null}
                    {source.status === "failed" ? (
                      <Button type="button" variant="secondary" size="sm" disabled={deletingIds.has(source.id)} onClick={() => void handleRetry(source)}>
                        <RefreshCw className="h-3.5 w-3.5" /> Retry
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: SourceStatus }) {
  if (status === "ready") {
    return <Badge className="border-blue/25 bg-blue-tint text-blue">READY</Badge>;
  }
  if (status === "failed") {
    return <Badge className="border-[#f2d1cf] bg-[#fff4f3] text-[#a53f34]">FAILED</Badge>;
  }
  return (
    <Badge className={cn("border-border bg-bg-alt text-text-muted")}>
      <LoaderCircle className="h-3 w-3 animate-spin" />
      {STATUS_COPY[status].toUpperCase()}
    </Badge>
  );
}
