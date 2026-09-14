"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

import { Button } from "@/components/ui/button";
import { mermaidPayloadSchema } from "@/lib/tutor";
import {
  FailedBlock,
  artifactStatusOf,
  useVisualArtifact,
} from "@/components/visual-block-helpers";

let mermaidInit: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid() {
  if (!mermaidInit) {
    mermaidInit = import("mermaid").then((module) => {
      // Strict mode: no click-handler execution, no arbitrary HTML/JS.
      module.default.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true });
      return module.default;
    });
  }
  return mermaidInit;
}

// Client-side mirror of the server guard: these never reach the renderer.
const UNSAFE_MERMAID_PATTERNS = [
  /<\s*script/i,
  /javascript:/i,
  /data:\s*text\/html/i,
  /\bclick\b[^\n]*\bcall\b/i,
  /\bon\w+\s*=/i,
];

/**
 * Renders a generated Mermaid diagram inside the notebook. `code` renders
 * only through Mermaid's strict security configuration; a render failure
 * keeps the source text and offers regeneration. The document stores only
 * the artifact id plus cached title/caption.
 */
export function MermaidBlockView({ node }: NodeViewProps) {
  const artifactId = typeof node.attrs.artifactId === "string" ? node.attrs.artifactId : null;
  const cachedTitle = typeof node.attrs.title === "string" ? node.attrs.title : "";
  const cachedCaption = typeof node.attrs.caption === "string" ? node.attrs.caption : "";
  const { artifact, retrying, retryError, retry } = useVisualArtifact(artifactId);
  const { state, error } = artifactStatusOf(artifact);

  const parsed = artifact ? mermaidPayloadSchema.safeParse(artifact.payload) : null;
  const payload = parsed?.success ? parsed.data : null;
  const title = artifact?.title || cachedTitle || "Diagram";
  const caption = payload?.caption || cachedCaption;

  return (
    <NodeViewWrapper className="mermaid-block" data-mermaid-block="true">
      <div contentEditable={false}>
          {state === "failed" ? (
            <div className="mt-3">
              <FailedBlock
                message={error ?? "The diagram could not be generated."}
                retrying={retrying}
                retryError={retryError}
                onRetry={() => void retry(title)}
              />
            </div>
          ) : !artifact || !payload ? (
            <p className="mt-3 flex items-center gap-2 font-body text-sm text-text-muted">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Loading diagram
            </p>
          ) : (
            // Keyed by artifact + code so regeneration remounts with fresh
            // render state instead of syncing state inside an effect.
            <MermaidBody
              key={`${artifact.id}:${payload.code}`}
              artifactId={artifact.id}
              title={title}
              code={payload.code}
              retrying={retrying}
              retryError={retryError}
              onRegenerate={() => void retry(title)}
            />
          )}

          {caption && payload ? <p className="mt-2 font-body text-xs leading-5 text-text-muted">{caption}</p> : null}
      </div>
    </NodeViewWrapper>
  );
}

function MermaidBody({
  artifactId,
  title,
  code,
  retrying,
  retryError,
  onRegenerate,
}: {
  artifactId: string;
  title: string;
  code: string;
  retrying: boolean;
  retryError: string | null;
  onRegenerate: () => void;
}) {
  const unsafe = UNSAFE_MERMAID_PATTERNS.some((pattern) => pattern.test(code));
  const [rendered, setRendered] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const svgHostRef = useRef<HTMLDivElement | null>(null);
  // Stable per-mount render target id. useId is deterministic per component
  // instance, so re-renders reuse the same id without impure generators.
  const renderId = `mmd-${artifactId.replace(/[^a-zA-Z0-9]/g, "")}-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  useEffect(() => {
    if (unsafe) return;
    let cancelled = false;
    loadMermaid()
      .then((mermaid) => mermaid.render(renderId, code))
      .then(({ svg }) => {
        if (cancelled) return;
        if (svgHostRef.current) {
          svgHostRef.current.innerHTML = svg;
          const svgEl = svgHostRef.current.querySelector("svg");
          if (!svgEl) throw new Error("Diagram renderer returned no SVG");
          // Preserve the diagram's natural dimensions instead of enlarging
          // narrow flowcharts to fill the editor.
          const naturalWidth = svgEl.viewBox.baseVal.width;
          if (naturalWidth > 0) {
            svgEl.setAttribute("width", String(naturalWidth));
            svgEl.style.width = `${naturalWidth}px`;
          }
          svgEl.style.maxWidth = "100%";
          svgEl.style.height = "auto";
        }
        setRendered(true);
      })
      .catch(() => {
        if (!cancelled) setInvalid(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code, renderId, unsafe]);

  if (unsafe || invalid) {
    return (
      <div className="mt-3 border border-[#f2d1cf] bg-[#fff4f3] p-3">
        <p className="font-body text-xs leading-5 text-[#93443d]">
          {unsafe
            ? "This diagram contained interactivity the notebook does not run. The source is kept below."
            : "This diagram could not be rendered. Try regenerating it."}
        </p>
        {!unsafe ? (
          <pre className="mt-2.5 overflow-x-auto border border-border bg-[#18231d] p-3 font-mono text-[11px] leading-5 text-[#dff3e4]">
            {code}
          </pre>
        ) : null}
        <div className="mt-2.5">
          <Button type="button" variant="danger" size="sm" disabled={retrying} onClick={onRegenerate}>
            {retrying ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {retrying ? "Regenerating" : "Regenerate"}
          </Button>
        </div>
        {retryError ? <p className="mt-2 font-body text-xs text-[#a53f34]">{retryError}</p> : null}
      </div>
    );
  }

  return (
    <>
      <div ref={svgHostRef} className="overflow-x-auto [&_svg]:mx-auto" role="img" aria-label={title} hidden={!rendered} />
      {!rendered ? (
        <p className="flex items-center gap-2 py-4 font-body text-sm text-text-muted" role="status">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Rendering diagram
        </p>
      ) : null}
    </>
  );
}
