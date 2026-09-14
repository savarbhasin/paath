"use client";

import { useCallback, useState } from "react";
import { ExternalLink, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ArtifactEnvelope } from "@/lib/contracts";
import { useExplanationArtifacts } from "@/components/explanation-artifacts-context";
import { useUpsertArtifact, type ArtifactWithStatus } from "@/components/generated-artifacts-store";

export function useVisualArtifact(artifactId: string | null): {
  artifact: ArtifactWithStatus | undefined;
  retrying: boolean;
  retryError: string | null;
  retry: (title: string) => Promise<boolean>;
} {
  const artifacts = useExplanationArtifacts();
  const upsert = useUpsertArtifact();
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const artifact = artifactId ? (artifacts.get(artifactId) as ArtifactWithStatus | undefined) : undefined;

  const retry = useCallback(
    async (title: string) => {
      if (!artifactId || retrying) return false;
      setRetrying(true);
      setRetryError(null);
      try {
        const response = await fetch(`/api/artifacts/${artifactId}/retry`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title }),
        });
        const payload = (await response.json()) as {
          artifact?: ArtifactWithStatus;
          status?: string;
          error?: string;
        };
        if (payload.artifact && typeof payload.artifact.id === "string") {
          upsert({ ...payload.artifact, status: payload.status ?? "ready", error: payload.error ?? null });
          if (!response.ok) {
            setRetryError(payload.error ?? "The block could not be regenerated.");
            return false;
          }
          return true;
        }
        throw new Error(payload.error ?? "The block could not be regenerated.");
      } catch (error) {
        setRetryError(error instanceof Error ? error.message : "The block could not be regenerated.");
        return false;
      } finally {
        setRetrying(false);
      }
    },
    [artifactId, retrying, upsert],
  );

  return { artifact, retrying, retryError, retry };
}

export function artifactStatusOf(artifact: ArtifactWithStatus | undefined): {
  state: "loading" | "failed" | "complete";
  error: string | null;
} {
  if (!artifact) return { state: "loading", error: null };
  if (artifact.status === "failed") {
    return {
      state: "failed",
      error: artifact.error ?? "Generation failed. Retry the block without losing the notebook.",
    };
  }
  return { state: "complete", error: null };
}

export function SourceLinks({ artifact }: { artifact: ArtifactEnvelope }) {
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const openSource = async (sourceId: string) => {
    setOpeningId(sourceId);
    setOpenError(null);
    try {
      const response = await fetch(`/api/sources/${sourceId}/open`, { cache: "no-store" });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        throw new Error(data.error ?? "The source could not be opened.");
      }
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : "The source could not be opened.");
    } finally {
      setOpeningId(null);
    }
  };

  const citations = artifact.citations ?? [];
  const unattributed = citations.length > 0 ? [] : (artifact.sourceIds ?? []);
  if (citations.length === 0 && unattributed.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
        Based on {citations.length > 0 ? citations.length : unattributed.length} source
        {citations.length === 1 && unattributed.length === 0 ? "" : "s"}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {citations.map((citation) => (
          <Button
            key={citation.sourceId}
            type="button"
            variant="outline"
            size="xs"
            disabled={openingId === citation.sourceId}
            onClick={() => void openSource(citation.sourceId)}
          >
            {openingId === citation.sourceId ? (
              <LoaderCircle className="h-3 w-3 animate-spin" />
            ) : (
              <ExternalLink className="h-3 w-3" />
            )}
            {citation.title}
            {citation.locator ? ` · ${citation.locator.kind} ${citation.locator.value}` : ""}
          </Button>
        ))}
        {unattributed.map((sourceId, index) => (
          <Button
            key={sourceId}
            type="button"
            variant="outline"
            size="xs"
            disabled={openingId === sourceId}
            onClick={() => void openSource(sourceId)}
          >
            {openingId === sourceId ? (
              <LoaderCircle className="h-3 w-3 animate-spin" />
            ) : (
              <ExternalLink className="h-3 w-3" />
            )}
            Source {index + 1}
          </Button>
        ))}
      </div>
      {openError ? <p className="mt-2 font-body text-xs text-[#a53f34]">{openError}</p> : null}
    </div>
  );
}

export function FailedBlock({
  message,
  retrying,
  retryError,
  onRetry,
}: {
  message: string;
  retrying: boolean;
  retryError: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="border border-[#f2d1cf] bg-[#fff4f3] p-3">
      <p className="font-body text-xs leading-5 text-[#93443d]">{message}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button type="button" variant="danger" size="sm" disabled={retrying} onClick={onRetry}>
          {retrying ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
          {retrying ? "Retrying" : "Retry"}
        </Button>
      </div>
      {retryError ? <p className="mt-2 font-body text-xs text-[#a53f34]">{retryError}</p> : null}
    </div>
  );
}
