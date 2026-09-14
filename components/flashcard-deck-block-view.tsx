"use client";

import { useEffect, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Eye, EyeOff, Layers, LoaderCircle, RefreshCw } from "lucide-react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useExplanationArtifacts } from "@/components/explanation-artifacts-context";
import { SourceLinks } from "@/components/visual-block-helpers";
import {
  REVIEW_RATING_LABEL,
  flashcardDeckPayloadSchema,
  type FlashcardDeckPayload,
  type ReviewRating,
} from "@/lib/study";
import { cn } from "@/lib/utils";

type CardReview = {
  cardId: string;
  rating: string;
  reviewedAt: string;
  nextReviewAt: string;
};

const RATINGS: ReviewRating[] = ["again", "hard", "good", "easy"];

/**
 * Renders a generated flashcard deck inside the notebook. Cards reveal on
 * demand and each rating persists a review row with a deterministic
 * next-review date. The document stores only the artifact id.
 */
export function FlashcardDeckBlockView({ node }: NodeViewProps) {
  const artifactId = typeof node.attrs.artifactId === "string" ? node.attrs.artifactId : null;
  const cachedTitle = typeof node.attrs.title === "string" ? node.attrs.title : "";
  const cachedSubtitle = typeof node.attrs.subtitle === "string" ? node.attrs.subtitle : "";
  const artifacts = useExplanationArtifacts();
  const artifact = artifactId ? artifacts.get(artifactId) : undefined;

  const [reviews, setReviews] = useState<Record<string, CardReview>>({});
  const [reviewsError, setReviewsError] = useState<string | null>(null);
  const [reviewsKey, setReviewsKey] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // Derived during render (no reset effect): true until this artifact's
  // reviews have loaded once.
  const reviewsLoading = artifactId !== null && reviewsKey !== artifactId;

  // The view remounts per node, so the initial index is always fresh and no
  // reset effect is needed. Reviews load once per artifact id; every setState
  // below runs in the async continuation, never synchronously in the body.
  useEffect(() => {
    if (!artifactId || reviewsKey === artifactId) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const load = async () => {
        try {
          const response = await fetch(`/api/flashcards/${artifactId}/reviews`, { cache: "no-store" });
          const payload = (await response.json()) as { reviews?: CardReview[]; error?: string };
          if (cancelled) return;
          if (!response.ok) throw new Error(payload.error ?? "Reviews could not be loaded.");
          const next: Record<string, CardReview> = {};
          for (const review of payload.reviews ?? []) {
            next[review.cardId] = review;
          }
          setReviews(next);
          setReviewsError(null);
        } catch (error) {
          if (!cancelled) {
            setReviewsError(error instanceof Error ? error.message : "Reviews could not be loaded.");
          }
        } finally {
          if (!cancelled) setReviewsKey(artifactId);
        }
      };
      void load();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [artifactId, reviewsKey]);

  const parsed = artifact ? flashcardDeckPayloadSchema.safeParse(artifact.payload) : null;
  const payload: FlashcardDeckPayload | null = parsed?.success ? parsed.data : null;
  const title = artifact?.title || cachedTitle || "Flashcards";
  const cards = payload?.cards ?? [];
  const subtitle = payload ? `${cards.length} card${cards.length === 1 ? "" : "s"}` : cachedSubtitle;
  // Clamp without an effect: the index is display-only and resets on remount.
  const safeIndex = cards.length === 0 ? 0 : Math.min(activeIndex, cards.length - 1);
  const activeCard = cards[safeIndex];
  const reviewedCount = cards.filter((card) => reviews[card.id]).length;

  const handleReviewed = (review: CardReview) => {
    setReviews((current) => ({ ...current, [review.cardId]: review }));
  };

  return (
    <NodeViewWrapper className="flashcard-deck-block" data-flashcard-deck-block="true">
      <div className="border border-border bg-paper" data-drag-handle>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-blue">
            <Layers className="h-3.5 w-3.5" /> AI flashcards
          </span>
          {payload ? (
            <Badge className="border-blue/25 bg-blue-tint text-blue">Saved to notebook</Badge>
          ) : artifact ? (
            <Badge className="border-[#f2d1cf] bg-[#fff4f3] text-[#a53f34]">Needs regeneration</Badge>
          ) : (
            <Badge>Loading deck</Badge>
          )}
          {payload ? <Badge>{`Card ${cards.length === 0 ? 0 : safeIndex + 1} of ${cards.length}`}</Badge> : null}
        </div>
        <div className="px-4 py-4">
          <p className="font-heading text-base font-medium tracking-[-0.01em] text-text">{title}</p>
          {subtitle ? <p className="mt-1 font-body text-sm text-text-muted">{subtitle}</p> : null}

          {!artifact ? (
            <p className="mt-3 flex items-center gap-2 font-body text-sm text-text-muted">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Loading deck
            </p>
          ) : !payload ? (
            <div className="mt-3 border border-[#f2d1cf] bg-[#fff4f3] p-3">
              <p className="font-body text-xs leading-5 text-[#93443d]">
                This deck came back malformed, so nothing usable was kept. Generate it again from the course chat.
              </p>
            </div>
          ) : (
            <>
              {reviewsError ? (
                <p className="mt-3 border border-border bg-white px-3 py-2 font-body text-xs leading-5 text-text-muted">
                  Past reviews could not be loaded ({reviewsError}). Rating a card still saves a new review.
                </p>
              ) : null}
              {activeCard ? (
                <DeckCard
                  key={activeCard.id}
                  artifactId={artifactId as string}
                  cardId={activeCard.id}
                  front={activeCard.front}
                  back={activeCard.back}
                  review={reviews[activeCard.id]}
                  reviewPending={reviewsLoading}
                  onReviewed={handleReviewed}
                />
              ) : null}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={safeIndex === 0}
                    onClick={() => setActiveIndex(safeIndex - 1)}
                    aria-label="Previous card"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Prev
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={safeIndex >= cards.length - 1}
                    onClick={() => setActiveIndex(safeIndex + 1)}
                    aria-label="Next card"
                  >
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="font-mono text-[11px] text-text-dim">
                  {reviewedCount} of {cards.length} reviewed
                </p>
              </div>
            </>
          )}

          {artifact ? <SourceLinks artifact={artifact} /> : null}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

function DeckCard({
  artifactId,
  cardId,
  front,
  back,
  review,
  reviewPending,
  onReviewed,
}: {
  artifactId: string;
  cardId: string;
  front: string;
  back: string;
  review: CardReview | undefined;
  reviewPending: boolean;
  onReviewed: (review: CardReview) => void;
}) {
  // Keyed by card id above, so revealed/rating state is per-card without a
  // reset effect.
  const [revealed, setRevealed] = useState(false);
  const [busyRating, setBusyRating] = useState<ReviewRating | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [failedRating, setFailedRating] = useState<ReviewRating | null>(null);
  const [masteryNote, setMasteryNote] = useState<string | null>(null);

  const rate = async (rating: ReviewRating) => {
    if (busyRating) return;
    setBusyRating(rating);
    setSaveError(null);
    try {
      const response = await fetch(`/api/flashcards/${artifactId}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardId, rating }),
      });
      const payload = (await response.json()) as {
        review?: CardReview;
        error?: string;
        mastery?: { topicKey: string; displayLabel: string } | null;
      };
      if (!response.ok || !payload.review) {
        throw new Error(payload.error ?? "The review could not be saved.");
      }
      setFailedRating(null);
      setMasteryNote(payload.mastery ? `${payload.mastery.topicKey}: ${payload.mastery.displayLabel}` : null);
      onReviewed(payload.review);
    } catch (error) {
      setFailedRating(rating);
      setSaveError(error instanceof Error ? error.message : "The review could not be saved.");
    } finally {
      setBusyRating(null);
    }
  };

  return (
    <div className="mt-3 border border-border bg-white">
      <div className="px-4 py-4">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">Front</p>
        <p className="mt-1.5 font-body text-[15px] font-medium leading-7 text-text">{front}</p>
        {revealed ? (
          <div className="flashcard-reveal mt-3 border-t border-border pt-3">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">Back</p>
            <p className="mt-1.5 whitespace-pre-wrap font-body text-sm leading-6 text-text">{back}</p>
          </div>
        ) : null}
        <div className="mt-3">
          <Button type="button" variant="outline" size="sm" onClick={() => setRevealed((current) => !current)}>
            {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {revealed ? "Hide answer" : "Reveal answer"}
          </Button>
        </div>
      </div>
      <div className="border-t border-border bg-paper px-4 py-3">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
          {review ? `Last rating: ${REVIEW_RATING_LABEL[(review.rating as ReviewRating) ?? "good"] ?? review.rating}` : "Rate this card"}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Rate this card">
          {RATINGS.map((rating) => (
            <button
              key={rating}
              type="button"
              disabled={busyRating !== null || reviewPending}
              onClick={() => void rate(rating)}
              aria-pressed={review?.rating === rating}
              className={cn(
                "pressable inline-flex h-8 items-center gap-1.5 border px-2.5 font-body text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                review?.rating === rating
                  ? "border-blue bg-blue text-white"
                  : "border-border bg-white text-text-muted hover:bg-bg-alt hover:text-text",
              )}
            >
              {busyRating === rating ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
              {REVIEW_RATING_LABEL[rating]}
            </button>
          ))}
        </div>
        {review ? (
          <p className="mt-2 font-body text-xs text-text-muted">
            Next review {formatDueDate(review.nextReviewAt)}
            {masteryNote ? ` · Mastery ${masteryNote}` : ""}
          </p>
        ) : null}
        {saveError ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 border border-[#f2d1cf] bg-[#fff4f3] px-2.5 py-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[#93443d]" />
            <p className="flex-1 font-body text-xs text-[#93443d]">{saveError}</p>
            {failedRating ? (
              <Button type="button" variant="danger" size="sm" disabled={busyRating !== null} onClick={() => void rate(failedRating)}>
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatDueDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "soon";
  return `on ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })} at ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}
