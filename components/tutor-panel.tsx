"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight, ExternalLink, LoaderCircle, RefreshCw, Sparkles, User, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChatMarkdown } from "@/components/chat-markdown";
import { Input } from "@/components/ui/input";
import type { Notebook } from "@/lib/domain";
import type { NotebookSelection } from "@/components/notebook-editor";
import { ANSWER_BASIS_LABEL, type AnswerBasis, type ChatMessage, type ChatThread } from "@/lib/tutor";
import type { Citation } from "@/lib/contracts";
import { cn } from "@/lib/utils";

type ContextInfo = {
  profileUsed: boolean;
  readySources: number;
  hasEvidence: boolean;
};

type StreamEvent = { event: string; data: Record<string, unknown> };

async function* readServerEvents(response: Response): AsyncGenerator<StreamEvent> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The tutor stream could not be opened.");
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const eventLine = frame.split("\n").find((line) => line.startsWith("event:"));
        const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
        if (!eventLine || !dataLine) continue;
        try {
          yield {
            event: eventLine.slice("event:".length).trim(),
            data: JSON.parse(dataLine.slice("data:".length).trim()) as Record<string, unknown>,
          };
        } catch {
          // Skip malformed frames; the completed message is authoritative.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function openSource(sourceId: string): Promise<string | null> {
  const response = await fetch(`/api/sources/${sourceId}/open`, { cache: "no-store" });
  const payload = (await response.json()) as { url?: string; error?: string };
  if (!response.ok || !payload.url) {
    throw new Error(payload.error ?? "The source could not be opened.");
  }
  window.open(payload.url, "_blank", "noopener,noreferrer");
  return null;
}

const TEMP_ASSISTANT_ID = "__streaming__";

/**
 * Chat-only tutor conversation. Notebook content generation (explanation,
 * diagram, image) lives exclusively in the inline Ask-AI box; quizzes and
 * flashcards live in the course chat. This panel only answers questions with
 * streaming + citations, reusing the persisted per-notebook thread routes.
 */
export function TutorPanel({
  courseId,
  notebook,
  selection,
  seedQuestion,
  hideHeader,
}: {
  courseId: string;
  notebook: Notebook | null;
  selection: NotebookSelection;
  /** Prefill for the question draft, read once as initial state. */
  seedQuestion?: string;
  /** Hide the title block when embedded under an existing header (e.g. floating tutor). */
  hideHeader?: boolean;
}) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [contextInfo, setContextInfo] = useState<ContextInfo | null>(null);
  const [question, setQuestion] = useState(seedQuestion ?? "");
  const [useSelection, setUseSelection] = useState(true);
  const [isAsking, setIsAsking] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const notebookId = notebook?.id ?? null;
  const selectedText = selection.text.trim();
  const effectiveSelection = useSelection ? selectedText : "";

  // The panel remounts per course+notebook (see the parent key), so the
  // initial state below is always fresh and no reset effect is needed.
  const loadThreads = useCallback(async () => {
    const params = new URLSearchParams({ courseId });
    if (notebookId) params.set("notebookId", notebookId);
    const response = await fetch(`/api/tutor/threads?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) {
      setHistoryLoading(false);
      return;
    }
    const payload = (await response.json()) as { threads?: ChatThread[] };
    if (!Array.isArray(payload.threads)) {
      setHistoryLoading(false);
      return;
    }
    setThreads(payload.threads);
    if (payload.threads.length > 0) {
      setActiveThreadId(payload.threads[0].id);
    } else {
      setHistoryLoading(false);
    }
  }, [courseId, notebookId]);

  const loadMessages = useCallback(async (threadId: string | null) => {
    if (!threadId) {
      setMessages([]);
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/tutor/threads/${threadId}/messages?limit=20`, { cache: "no-store" });
      if (!response.ok) throw new Error("Chat history could not be loaded.");
      const payload = (await response.json()) as { messages?: ChatMessage[] };
      setMessages(Array.isArray(payload.messages) ? payload.messages : []);
    } catch {
      setMessages([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadThreads(), 0);
    return () => window.clearTimeout(timer);
  }, [loadThreads]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadMessages(activeThreadId), 0);
    return () => window.clearTimeout(timer);
  }, [activeThreadId, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, isAsking]);

  const ask = useCallback(async (retryQuestion?: string) => {
    const text = (retryQuestion ?? question).trim();
    if (!text || isAsking) return;
    setIsAsking(true);
    setStreamError(null);
    setQuestion("");

    const userMessage: ChatMessage = {
      id: `temp-user-${Date.now()}`,
      threadId: activeThreadId ?? "pending",
      role: "user",
      content: text,
      citations: [],
      answerBasis: null,
    };
    const streamingMessage: ChatMessage = {
      id: TEMP_ASSISTANT_ID,
      threadId: activeThreadId ?? "pending",
      role: "assistant",
      content: "",
      citations: [],
      answerBasis: null,
    };
    setMessages((current) => [...current, userMessage, streamingMessage]);

    try {
      const response = await fetch("/api/tutor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          courseId,
          notebookId,
          threadId: activeThreadId,
          question: text,
          selectedText: effectiveSelection || null,
        }),
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "The tutor could not answer.");
      }

      let donePayload: { messageId?: string; answerBasis?: AnswerBasis; citations?: Citation[] } | null = null;
      for await (const { event, data } of readServerEvents(response)) {
        if (event === "context") {
          const threadId = typeof data.threadId === "string" ? data.threadId : null;
          if (threadId && !activeThreadId) {
            setActiveThreadId(threadId);
          }
          setContextInfo({
            profileUsed: data.profileUsed === true,
            readySources: typeof data.readySources === "number" ? data.readySources : 0,
            hasEvidence: data.hasEvidence === true,
          });
          setThreads((current) => {
            if (threadId && !current.some((thread) => thread.id === threadId)) {
              return [{ id: threadId, courseId, notebookId, title: text.slice(0, 60), updatedAt: new Date().toISOString() }, ...current];
            }
            return current;
          });
        } else if (event === "delta") {
          const chunk = typeof data.text === "string" ? data.text : "";
          if (chunk) {
            setMessages((current) =>
              current.map((message) =>
                message.id === TEMP_ASSISTANT_ID ? { ...message, content: message.content + chunk } : message,
              ),
            );
          }
        } else if (event === "done") {
          donePayload = data as unknown as { messageId?: string; answerBasis?: AnswerBasis; citations?: Citation[] };
        } else if (event === "error") {
          throw new Error(typeof data.message === "string" ? data.message : "The tutor could not answer.");
        }
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === TEMP_ASSISTANT_ID
            ? {
                ...message,
                id: donePayload?.messageId ?? `assistant-${Date.now()}`,
                answerBasis: donePayload?.answerBasis ?? "general_knowledge",
                citations: Array.isArray(donePayload?.citations) ? (donePayload.citations as Citation[]) : [],
              }
            : message,
        ),
      );
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : "The tutor could not answer.");
      setMessages((current) => current.filter((message) => message.id !== TEMP_ASSISTANT_ID && message.id !== userMessage.id));
      setQuestion(text);
    } finally {
      setIsAsking(false);
    }
  }, [activeThreadId, courseId, effectiveSelection, isAsking, notebookId, question]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask();
  };

  const handleOpenSource = async (sourceId: string) => {
    setOpeningId(sourceId);
    setActionError(null);
    try {
      await openSource(sourceId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The source could not be opened.");
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {hideHeader ? null : (
            <div>
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-blue">Tutor</p>
              <h2 className="mt-1 font-heading text-lg font-medium tracking-[-0.02em] text-text">Ask your material</h2>
            </div>
          )}
          {contextInfo?.profileUsed ? (
            <Badge className="border-blue/25 bg-blue-tint text-blue">
              <Sparkles className="h-3 w-3" /> Personalized with memory
            </Badge>
          ) : null}
        </div>
        {threads.length > 1 ? (
          <div className="mt-3 flex gap-1 overflow-x-auto border border-border bg-paper p-1" role="group" aria-label="Chat threads">
            {threads.slice(0, 5).map((thread) => (
              <button
                key={thread.id}
                type="button"
                onClick={() => setActiveThreadId(thread.id)}
                className={cn(
                  "pressable max-w-[180px] truncate px-2.5 py-1.5 font-body text-xs font-medium transition-colors",
                  thread.id === activeThreadId ? "bg-blue text-white" : "text-text-muted hover:bg-bg-alt hover:text-text",
                )}
                title={thread.title}
              >
                {thread.title}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <CardContent className="p-0">
        <div className="max-h-[420px] min-h-[280px] overflow-y-auto px-5 py-4" aria-live="polite">
          {historyLoading ? (
            <p className="flex items-center gap-2 py-8 font-body text-sm text-text-muted">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Loading conversation
            </p>
          ) : messages.length === 0 ? (
            <div className="border border-dashed border-border-strong px-4 py-8 text-center">
              <Sparkles className="mx-auto h-6 w-6 text-text-dim" />
              <p className="mt-3 font-heading text-sm font-medium tracking-[-0.01em] text-text">Grounded in your sources</p>
              <p className="mx-auto mt-1 max-w-xs font-body text-xs leading-5 text-text-muted">
                Select a passage in the notebook, then ask. Answers cite only ready sources — anything else is marked as general knowledge.
              </p>
            </div>
          ) : (
            <ul className="space-y-4">
              {messages.map((message) => (
                <li key={message.id} className={cn("border px-3.5 py-3", message.role === "user" ? "border-border bg-paper" : "border-border-strong bg-white")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
                      {message.role === "user" ? <User className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                      {message.role === "user" ? "You" : "Tutor"}
                    </span>
                    {message.role === "assistant" && message.answerBasis ? (
                      <Badge
                        className={cn(
                          message.answerBasis === "source" && "border-blue/25 bg-blue-tint text-blue",
                          message.answerBasis === "mixed" && "border-border-strong bg-paper text-text",
                        )}
                      >
                        {ANSWER_BASIS_LABEL[message.answerBasis]}
                      </Badge>
                    ) : null}
                    {message.id === TEMP_ASSISTANT_ID ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin text-text-dim" />
                    ) : null}
                  </div>
                  {message.role === "assistant" ? (
                    <div className="mt-2">
                      <ChatMarkdown
                        text={
                          message.content || (message.id === TEMP_ASSISTANT_ID ? "Thinking with your sources..." : "")
                        }
                      />
                    </div>
                  ) : (
                    <p className="mt-2 whitespace-pre-wrap font-body text-sm leading-6 text-text">{message.content}</p>
                  )}
                  {message.citations.length > 0 ? (
                    <div className="mt-2.5 flex flex-wrap gap-1 border-t border-border pt-2.5">
                      {message.citations.map((citation) => (
                        <Button
                          key={citation.sourceId}
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={openingId === citation.sourceId}
                          onClick={() => void handleOpenSource(citation.sourceId)}
                        >
                          {openingId === citation.sourceId ? (
                            <LoaderCircle className="h-3 w-3 animate-spin" />
                          ) : (
                            <ExternalLink className="h-3 w-3" />
                          )}
                          {citation.marker ? (
                            <span className="font-mono text-[10px] font-medium text-blue">[{citation.marker}]</span>
                          ) : null}
                          {citation.title}
                          {citation.locator ? (
                            <span className="font-mono text-[10px] text-blue">
                              {citation.locator.kind} {citation.locator.value}
                            </span>
                          ) : null}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-border px-5 py-4">
          {effectiveSelection ? (
            <div className="mb-3 flex items-start gap-2 border border-blue/25 bg-blue/[0.06] px-3 py-2">
              <p className="min-w-0 flex-1 font-body text-xs leading-5 text-text">
                <span className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-blue">Using selection · </span>
                {effectiveSelection.length > 220 ? `${effectiveSelection.slice(0, 220)}...` : effectiveSelection}
              </p>
              <button
                type="button"
                onClick={() => setUseSelection(false)}
                className="pressable p-1 text-text-dim hover:text-text"
                aria-label="Clear selection from tutor context"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : selectedText ? (
            <button
              type="button"
              onClick={() => setUseSelection(true)}
              className="pressable mb-3 border border-dashed border-border-strong px-3 py-2 font-body text-xs text-text-muted hover:text-text"
            >
              Include the selected passage ({selectedText.length} chars) in the next question
            </button>
          ) : null}

          {contextInfo && !contextInfo.hasEvidence ? (
            <p className="mb-3 border border-border bg-paper px-3 py-2 font-body text-xs leading-5 text-text-muted">
              No ready source passages matched yet{contextInfo.readySources === 0 ? " — wait for a source to finish processing" : ""}. The tutor will say so instead of inventing citations.
            </p>
          ) : null}

          <form onSubmit={submit} className="flex gap-2">
            <Input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={notebook ? `Ask about ${notebook.title}` : "Ask the tutor"}
              aria-label="Ask the tutor"
              disabled={isAsking}
            />
            <button
              type="submit"
              disabled={isAsking || !question.trim()}
              className="pressable flex h-10 items-stretch overflow-hidden border border-blue bg-blue text-white transition-colors hover:bg-blue-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="flex flex-1 items-center justify-center whitespace-nowrap px-4 font-body text-sm font-medium">
                {isAsking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "Ask"}
              </span>
              <span className="flex w-10 items-center justify-center border-l border-white/20">
                <ArrowRight className="h-4 w-4" />
              </span>
            </button>
          </form>

          {streamError ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 border border-[#f2d1cf] bg-[#fff4f3] p-3">
              <AlertCircle className="h-4 w-4 shrink-0 text-[#93443d]" />
              <p className="flex-1 font-body text-xs leading-5 text-[#93443d]">{streamError}</p>
              <Button type="button" variant="danger" size="sm" onClick={() => void ask()} disabled={isAsking}>
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </Button>
            </div>
          ) : null}
          {actionError ? <p className="mt-2 font-body text-xs text-[#a53f34]">{actionError}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
