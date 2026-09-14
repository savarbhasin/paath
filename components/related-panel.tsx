"use client";

import { FormEvent, useCallback, useState } from "react";
import { AlertCircle, ExternalLink, FileText, Link2, LoaderCircle, RefreshCw, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type RelatedResponse = {
  sources: Array<{ sourceId: string; title: string; excerpt: string; similarity: number | null }>;
  notebooks: Array<{ notebookId: string; title: string; excerpt: string }>;
};

/**
 * Ticket 07 connections between material. Searches a notebook selection
 * against other ready sources in Supermemory and saved notebook text in
 * Supabase, then opens the chosen source or notebook. Course-scoped, so
 * recommendations never mix unrelated courses. Remounts per course + notebook
 * (see the parent key).
 */
export function RelatedPanel({
  courseId,
  notebookId,
  selectionText,
  onSelectNotebook,
}: {
  courseId: string;
  notebookId: string | null;
  selectionText: string;
  onSelectNotebook: (notebookId: string) => void;
}) {
  const [query, setQuery] = useState(selectionText);
  const [results, setResults] = useState<RelatedResponse | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const runSearch = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isSearching) return;
      setIsSearching(true);
      setSearchError(null);
      try {
        const params = new URLSearchParams({ courseId, text: trimmed.slice(0, 2000) });
        if (notebookId) params.set("notebookId", notebookId);
        const response = await fetch(`/api/related?${params.toString()}`, { cache: "no-store" });
        const payload = (await response.json()) as RelatedResponse & { error?: string };
        if (!response.ok || !Array.isArray(payload.sources) || !Array.isArray(payload.notebooks)) {
          throw new Error(payload.error ?? "Related material could not be loaded.");
        }
        setResults(payload);
        setHasSearched(true);
      } catch (error) {
        setSearchError(error instanceof Error ? error.message : "Related material could not be loaded.");
        setHasSearched(true);
      } finally {
        setIsSearching(false);
      }
    },
    [courseId, isSearching, notebookId],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void runSearch(query);
  };

  const openSource = useCallback(async (sourceId: string) => {
    setOpeningId(sourceId);
    try {
      const response = await fetch(`/api/sources/${sourceId}/open`, { cache: "no-store" });
      const payload = (await response.json()) as { url?: string; error?: string };
      if (!response.ok || !payload.url) throw new Error(payload.error ?? "The source could not be opened.");
      window.open(payload.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "The source could not be opened.");
    } finally {
      setOpeningId(null);
    }
  }, []);

  const totalCount = (results?.sources.length ?? 0) + (results?.notebooks.length ?? 0);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b border-border px-5 py-4">
          <p className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-blue">
            <Link2 className="h-3.5 w-3.5" /> Connections
          </p>
          <h2 className="mt-1 font-heading text-lg font-medium tracking-[-0.02em] text-text">Related material</h2>
          <p className="mt-1 font-body text-sm leading-6 text-text-muted">
            Select a concept in the notebook, then find where else this course covers it.
          </p>
        </div>

        <form onSubmit={submit} className="flex flex-wrap gap-2 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1 basis-64">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="A concept, term, or question"
              aria-label="Concept to connect"
            />
          </div>
          {selectionText.trim() && selectionText.trim() !== query.trim() ? (
            <Button type="button" variant="outline" onClick={() => setQuery(selectionText)}>
              Use selection
            </Button>
          ) : null}
          <Button type="submit" disabled={isSearching || !query.trim()}>
            {isSearching ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Find related
          </Button>
        </form>

        <div className="px-5 py-4">
          {searchError ? (
            <div className="flex flex-wrap items-center gap-3 border border-[#f2d1cf] bg-[#fff4f3] p-4">
              <AlertCircle className="h-4 w-4 shrink-0 text-[#93443d]" />
              <p className="flex-1 font-body text-sm text-[#93443d]">{searchError}</p>
              <Button type="button" variant="danger" size="sm" onClick={() => void runSearch(query)}>
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </Button>
            </div>
          ) : !hasSearched ? (
            <p className="py-4 font-body text-sm leading-6 text-text-muted">
              Results link back to the other source or notebook they came from — nothing is copied, and nothing leaves
              this course.
            </p>
          ) : totalCount === 0 ? (
            <div className="border border-dashed border-border-strong px-4 py-8 text-center">
              <Search className="mx-auto h-6 w-6 text-text-dim" />
              <p className="mt-3 font-heading text-sm font-medium tracking-[-0.01em] text-text">No connections yet</p>
              <p className="mx-auto mt-1 max-w-xs font-body text-xs leading-5 text-text-muted">
                Nothing else in this course covers that concept. Add another source or notebook page first.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {results && results.sources.length > 0 ? (
                <section aria-label="Related sources">
                  <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
                    Other sources · {results.sources.length}
                  </p>
                  <ul className="mt-2 divide-y divide-border border-y border-border">
                    {results.sources.map((source) => (
                      <li key={source.sourceId} className="px-1 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="min-w-0 flex-1 truncate font-body text-sm font-medium text-text">{source.title}</p>
                          {source.similarity !== null ? (
                            <Badge>{Math.round(source.similarity * 100)}% match</Badge>
                          ) : null}
                        </div>
                        {source.excerpt ? (
                          <p className="mt-2 border-l-2 border-blue bg-paper px-3 py-2 font-body text-sm leading-6 text-text-muted">
                            {source.excerpt}
                          </p>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          disabled={openingId === source.sourceId}
                          onClick={() => void openSource(source.sourceId)}
                        >
                          {openingId === source.sourceId ? (
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ExternalLink className="h-3.5 w-3.5" />
                          )}
                          Open source
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {results && results.notebooks.length > 0 ? (
                <section aria-label="Related notebooks">
                  <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
                    Other notebooks · {results.notebooks.length}
                  </p>
                  <ul className="mt-2 divide-y divide-border border-y border-border">
                    {results.notebooks.map((notebook) => (
                      <li key={notebook.notebookId} className="px-1 py-3">
                        <p className="font-body text-sm font-medium text-text">{notebook.title}</p>
                        <p className="mt-2 border-l-2 border-blue bg-paper px-3 py-2 font-body text-sm leading-6 text-text-muted">
                          {notebook.excerpt}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          onClick={() => onSelectNotebook(notebook.notebookId)}
                        >
                          <FileText className="h-3.5 w-3.5" /> Open notebook
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
