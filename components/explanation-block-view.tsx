"use client";

import { useState } from "react";
import { ExternalLink, LoaderCircle, Sparkles } from "lucide-react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ArtifactEnvelope } from "@/lib/contracts";
import { explanationPayloadSchema } from "@/lib/tutor";
import { useExplanationArtifacts } from "@/components/explanation-artifacts-context";

function useArtifact(artifactId: string | null): ArtifactEnvelope | undefined {
  const artifacts = useExplanationArtifacts();
  if (!artifactId) return undefined;
  return artifacts.get(artifactId);
}

/** Section bodies are model-written Markdown — render bold/italics/lists with
 *  notebook type styles. Raw HTML is never rendered (react-markdown default). */
const explanationMarkdown: Components = {
  p: ({ children }) => <>{children}</>,
  strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  ul: ({ children }) => <ul className="mt-1 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mt-1 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-6">{children}</li>,
  code: ({ children }) => <code className="bg-white px-1 font-mono text-[13px]">{children}</code>,
};

/**
 * Renders a generated explanation inside the notebook. Display text comes
 * from the artifact payload; the document itself stores only the artifact id.
 */
export function ExplanationBlockView({ node }: NodeViewProps) {
  const artifactId = typeof node.attrs.artifactId === "string" ? node.attrs.artifactId : null;
  const cachedTitle = typeof node.attrs.title === "string" ? node.attrs.title : "";
  const cachedSummary = typeof node.attrs.summary === "string" ? node.attrs.summary : "";
  const artifact = useArtifact(artifactId);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const parsed = artifact ? explanationPayloadSchema.safeParse(artifact.payload) : null;
  const payload = parsed?.success ? parsed.data : null;
  const title = artifact?.title || cachedTitle || "Explanation";
  const summary = payload?.summary || cachedSummary;

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

  const citations = artifact?.citations ?? [];
  const sourceIds = citations.length > 0 ? [] : (artifact?.sourceIds ?? []);

  return (
    <NodeViewWrapper className="explanation-block" data-explanation-block="true">
      <div className="border border-border bg-paper" data-drag-handle>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-blue">
            <Sparkles className="h-3.5 w-3.5" /> AI explanation
          </span>
          {artifact ? (
            <Badge className="border-blue/25 bg-blue-tint text-blue">Saved to notebook</Badge>
          ) : (
            <Badge>Loading explanation</Badge>
          )}
        </div>
        <div className="px-4 py-4">
          <p className="font-heading text-base font-medium tracking-[-0.01em] text-text">{title}</p>
          {summary ? <p className="mt-1.5 font-body text-sm leading-6 text-text-muted">{summary}</p> : null}
          {payload ? (
            <div className="mt-3 space-y-3">
              {payload.sections.map((section) => (
                <div key={section.heading}>
                  <p className="font-body text-sm font-semibold tracking-[-0.005em] text-text">{section.heading}</p>
                  <div className="mt-1 font-body text-sm leading-6 text-text-muted">
                    <ReactMarkdown
                      components={explanationMarkdown}
                      remarkPlugins={[remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                    >
                      {section.markdown}
                    </ReactMarkdown>
                  </div>
                </div>
              ))}
              {payload.example ? (
                <div className="border border-border bg-white px-3 py-2.5">
                  <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">Example</p>
                  <p className="mt-1 whitespace-pre-wrap font-body text-sm leading-6 text-text">{payload.example}</p>
                </div>
              ) : null}
            </div>
          ) : null}
          {citations.length > 0 || sourceIds.length > 0 ? (
            <div className="mt-3 border-t border-border pt-3">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
                Based on {citations.length > 0 ? citations.length : sourceIds.length} source{citations.length === 1 && sourceIds.length === 0 ? "" : "s"}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {citations.map((citation) => (
                  <Button
                    key={citation.sourceId}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={openingId === citation.sourceId}
                    onClick={() => void openSource(citation.sourceId)}
                  >
                    {openingId === citation.sourceId ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ExternalLink className="h-3.5 w-3.5" />
                    )}
                    {citation.title}
                    {citation.locator ? ` · ${citation.locator.kind} ${citation.locator.value}` : ""}
                  </Button>
                ))}
                {sourceIds.map((sourceId, index) => (
                  <Button
                    key={sourceId}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={openingId === sourceId}
                    onClick={() => void openSource(sourceId)}
                  >
                    {openingId === sourceId ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ExternalLink className="h-3.5 w-3.5" />
                    )}
                    Source {index + 1}
                  </Button>
                ))}
              </div>
              {openError ? <p className="mt-2 font-body text-xs text-[#a53f34]">{openError}</p> : null}
            </div>
          ) : null}
        </div>
      </div>
    </NodeViewWrapper>
  );
}
