"use client";

import { FormEvent, useCallback, useState } from "react";
import { AlertCircle, ExternalLink, LoaderCircle, RefreshCw, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { NormalizedSearchResult } from "@/lib/sources";

type SearchResponse =
  | { results: NormalizedSearchResult[]; readySources: number; scope: string; diagnostic: null }
  | { error: string; providerCode?: string; results: [] };
type OpenResponse = { url: string; kind: string } | { error: string };

export function SearchPanel({ courseId }: { courseId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NormalizedSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const runSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed || isSearching) return;
    setIsSearching(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams({ q: trimmed, scope: "course", limit: "8", courseId });
      const response = await fetch(`/api/search?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json()) as SearchResponse;
      if (!response.ok || !("results" in payload) || !Array.isArray(payload.results)) {
        throw new Error("error" in payload ? payload.error : "Search failed.");
      }
      setResults(payload.results);
      setHasSearched(true);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Search failed.");
      setHasSearched(true);
    } finally {
      setIsSearching(false);
    }
  }, [courseId, isSearching, query]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void runSearch();
  };

  const openResult = useCallback(async (sourceId: string) => {
    setOpeningId(sourceId);
    try {
      const response = await fetch(`/api/sources/${sourceId}/open`, { cache: "no-store" });
      const payload = (await response.json()) as OpenResponse;
      if (!response.ok || !("url" in payload)) {
        throw new Error("error" in payload ? payload.error : "The source could not be opened.");
      }
      window.open(payload.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "The source could not be opened.");
    } finally {
      setOpeningId(null);
    }
  }, []);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="border-b border-border px-5 py-4">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-blue">Search</p>
          <h2 className="mt-1 font-heading text-lg font-medium tracking-[-0.02em] text-text">
            Find it in your material
          </h2>
        </div>

        <form onSubmit={submit} className="flex gap-2 border-b border-border px-5 py-4">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search this course"
            aria-label="Search sources"
          />
          <Button type="submit" disabled={isSearching || !query.trim()}>
            {isSearching ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Search
          </Button>
        </form>

        <div className="px-5 py-4">
          {searchError ? (
            <div className="flex flex-wrap items-center gap-3 border border-[#f2d1cf] bg-[#fff4f3] p-4">
              <AlertCircle className="h-4 w-4 shrink-0 text-[#93443d]" />
              <p className="flex-1 font-body text-sm text-[#93443d]">{searchError}</p>
              <Button type="button" variant="danger" size="sm" onClick={() => void runSearch()}>
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </Button>
            </div>
          ) : !hasSearched ? (
            <p className="py-4 font-body text-sm leading-6 text-text-muted">
              Ask about anything in your ready sources. Results always link back to the file or video they came from.
            </p>
          ) : results.length === 0 ? (
            <div className="border border-dashed border-border-strong px-4 py-8 text-center">
              <Search className="mx-auto h-6 w-6 text-text-dim" />
              <p className="mt-3 font-heading text-sm font-medium tracking-[-0.01em] text-text">Nothing found</p>
              <p className="mx-auto mt-1 max-w-xs font-body text-xs leading-5 text-text-muted">
                No ready source in this course supported that question. Try
                different words, or wait for processing to finish.
              </p>
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto border-y border-border">
              {results.map((result, index) => (
                <li key={`${result.sourceId}-${index}`} className="px-1 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 truncate font-body text-sm font-medium tracking-[-0.005em] text-text">
                      {result.title}
                    </p>
                    {result.similarity !== null ? (
                      <Badge>{Math.round(result.similarity * 100)}% match</Badge>
                    ) : null}
                    {result.locator ? (
                      <Badge className="border-blue/25 bg-blue-tint font-mono text-[11px] text-blue">
                        {result.locator.kind.toUpperCase()} {result.locator.value}
                      </Badge>
                    ) : null}
                  </div>
                  {result.excerpt ? (
                    <p className="mt-2 border-l-2 border-blue bg-paper px-3 py-2 font-body text-sm leading-6 text-text-muted">
                      {result.excerpt}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    disabled={openingId === result.sourceId}
                    onClick={() => void openResult(result.sourceId)}
                  >
                    {openingId === result.sourceId ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ExternalLink className="h-3.5 w-3.5" />
                    )}
                    Open source
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
