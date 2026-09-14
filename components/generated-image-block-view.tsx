"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink, Image as ImageIcon, LoaderCircle, RefreshCw } from "lucide-react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { imagePayloadSchema } from "@/lib/tutor";
import {
  FailedBlock,
  SourceLinks,
  artifactStatusOf,
  useVisualArtifact,
} from "@/components/visual-block-helpers";

/**
 * Renders a generated image inside the notebook. Bytes live in private
 * Supabase Storage; the view resolves a fresh signed URL per mount, so the
 * block survives reload without a temporary provider URL. Regenerate, open,
 * and download actions keep working from the persisted storage path.
 */
export function GeneratedImageBlockView({ node }: NodeViewProps) {
  const artifactId = typeof node.attrs.artifactId === "string" ? node.attrs.artifactId : null;
  const cachedTitle = typeof node.attrs.title === "string" ? node.attrs.title : "";
  const cachedCaption = typeof node.attrs.caption === "string" ? node.attrs.caption : "";
  const { artifact, retrying, retryError, retry } = useVisualArtifact(artifactId);
  const { state, error } = artifactStatusOf(artifact);

  const parsed = artifact ? imagePayloadSchema.safeParse(artifact.payload) : null;
  const payload = parsed?.success ? parsed.data : null;
  const title = artifact?.title || cachedTitle || "Generated image";
  const caption = payload?.caption || cachedCaption;

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"open" | "download" | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Reset per artifact (render-phase adjustment for a new artifact id).
  const [trackedArtifactId, setTrackedArtifactId] = useState(artifactId);
  if (trackedArtifactId !== artifactId) {
    setTrackedArtifactId(artifactId);
    setImageUrl(null);
    setImageError(null);
  }

  // Loading state is derived during render; only the async continuations
  // below call setState, so no state updates happen inside the effect body.
  const imageState =
    state !== "complete" || !payload ? "idle" : imageError ? "failed" : imageUrl ? "ready" : "loading";

  // Stable string dep: the parsed payload object identity changes every render.
  const payloadKey = artifact ? JSON.stringify(artifact.payload) : null;

  // A fresh signed URL per mount: persisted storage survives reload.
  useEffect(() => {
    if (state !== "complete" || !payloadKey || !artifactId) return;
    let cancelled = false;
    fetch(`/api/artifacts/${artifactId}/image`, { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json()) as { url?: string; error?: string };
        if (!response.ok || !data.url) {
          throw new Error(data.error ?? "The image could not be opened from storage.");
        }
        return data.url;
      })
      .then((url) => {
        if (cancelled) return;
        setImageUrl(url);
        setImageError(null);
      })
      .catch((fetchError: unknown) => {
        if (cancelled) return;
        setImageError(fetchError instanceof Error ? fetchError.message : "The image could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [state, payloadKey, artifactId, reloadKey]);

  const reloadImage = () => {
    setImageUrl(null);
    setImageError(null);
    setReloadKey((key) => key + 1);
  };

  const openImage = async () => {
    if (!imageUrl) return;
    setBusyAction("open");
    try {
      window.open(imageUrl, "_blank", "noopener,noreferrer");
    } finally {
      setBusyAction(null);
    }
  };

  const downloadImage = async () => {
    if (!artifactId) return;
    setBusyAction("download");
    try {
      const response = await fetch(`/api/artifacts/${artifactId}/image`, { cache: "no-store" });
      const data = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !data.url) {
        throw new Error(data.error ?? "The image could not be downloaded.");
      }
      const file = await fetch(data.url);
      if (!file.ok) throw new Error("The image could not be downloaded.");
      const blob = await file.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "generated-image"}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
    } catch {
      setImageError("The image could not be downloaded. Try opening it instead.");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <NodeViewWrapper className="generated-image-block" data-generated-image-block="true">
      <div className="border border-border bg-paper" data-drag-handle>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-blue">
            <ImageIcon className="h-3.5 w-3.5" /> AI image
          </span>
          {state === "complete" ? (
            <Badge className="border-blue/25 bg-blue-tint text-blue">Saved to notebook</Badge>
          ) : state === "failed" ? (
            <Badge className="border-[#f2d1cf] bg-[#fff4f3] text-[#a53f34]">Failed</Badge>
          ) : (
            <Badge>Loading image</Badge>
          )}
          {retrying ? (
            <Badge className="border-blue/25 bg-blue-tint text-blue">
              <LoaderCircle className="h-3 w-3 animate-spin" /> Retrying
            </Badge>
          ) : null}
        </div>
        <div className="px-4 py-4">
          <p className="font-heading text-base font-medium tracking-[-0.01em] text-text">{title}</p>
          {caption ? <p className="mt-1.5 font-body text-sm leading-6 text-text-muted">{caption}</p> : null}

          {state === "failed" ? (
            <div className="mt-3">
              <FailedBlock
                message={error ?? "The image could not be generated. No broken block was kept."}
                retrying={retrying}
                retryError={retryError}
                onRetry={() => void retry(title)}
              />
            </div>
          ) : !artifact ? (
            <p className="mt-3 flex items-center gap-2 font-body text-sm text-text-muted">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Loading image
            </p>
          ) : !payload ? (
            <div className="mt-3 border border-[#f2d1cf] bg-[#fff4f3] p-3">
              <p className="font-body text-xs leading-5 text-[#93443d]">
                This image has no stored file. Regenerate it to create a fresh copy.
              </p>
              <div className="mt-2.5">
                <Button type="button" variant="danger" size="sm" disabled={retrying} onClick={() => void retry(title)}>
                  {retrying ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {retrying ? "Regenerating" : "Regenerate"}
                </Button>
              </div>
              {retryError ? <p className="mt-2 font-body text-xs text-[#a53f34]">{retryError}</p> : null}
            </div>
          ) : imageState === "loading" || imageState === "idle" ? (
            <p className="mt-3 flex items-center gap-2 border border-border bg-white px-3 py-6 font-body text-sm text-text-muted">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Loading image
            </p>
          ) : imageState === "failed" ? (
            <div className="mt-3 border border-[#f2d1cf] bg-[#fff4f3] p-3">
              <p className="font-body text-xs leading-5 text-[#93443d]">{imageError}</p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button type="button" variant="danger" size="sm" onClick={reloadImage}>
                  <RefreshCw className="h-3.5 w-3.5" /> Reload
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={retrying} onClick={() => void retry(title)}>
                  {retrying ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Regenerate
                </Button>
              </div>
              {retryError ? <p className="mt-2 font-body text-xs text-[#a53f34]">{retryError}</p> : null}
            </div>
          ) : (
            <>
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt={payload.alt} className="mt-3 max-h-[420px] w-full border border-border bg-white object-contain" />
              ) : null}
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" disabled={retrying} onClick={() => void retry(title)}>
                  {retrying ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {retrying ? "Regenerating" : "Regenerate"}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={!imageUrl || busyAction !== null} onClick={() => void openImage()}>
                  {busyAction === "open" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                  Open
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={!imageUrl || busyAction !== null} onClick={() => void downloadImage()}>
                  {busyAction === "download" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  Download
                </Button>
              </div>
              {retryError ? <p className="mt-2 font-body text-xs text-[#a53f34]">{retryError}</p> : null}
            </>
          )}

          {artifact ? <SourceLinks artifact={artifact} /> : null}
        </div>
      </div>
    </NodeViewWrapper>
  );
}
