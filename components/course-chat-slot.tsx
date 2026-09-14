"use client";

import { FormEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  ExternalLink,
  Layers,
  ListChecks,
  LoaderCircle,
  Menu,
  Plus,
  RefreshCw,
  Sparkles,
  User,
  Wrench,
  Video,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ChatMarkdown } from "@/components/chat-markdown";
import { Input } from "@/components/ui/input";
import { type AnswerBasis, type ChatMessage, type ChatThread } from "@/lib/tutor";
import type { Citation } from "@/lib/contracts";
import { cn } from "@/lib/utils";

type ToolLine = {
  name: string;
  summary: string;
  artifact?: { id: string; kind: string; title: string; url: string };
  sessionId?: string | null;
};

type CourseChatMessage = ChatMessage & {
  tools?: ToolLine[];
  artifacts?: Array<{ id: string; kind: string; title: string; url: string }>;
  sessionStarted?: boolean;
};

type StreamEvent = { event: string; data: Record<string, unknown> };

async function* readServerEvents(response: Response): AsyncGenerator<StreamEvent> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The course chat stream could not be opened.");
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

async function openSource(sourceId: string): Promise<void> {
  const response = await fetch(`/api/sources/${sourceId}/open`, { cache: "no-store" });
  const payload = (await response.json()) as { url?: string; error?: string };
  if (!response.ok || !payload.url) {
    throw new Error(payload.error ?? "The source could not be opened.");
  }
  window.open(payload.url, "_blank", "noopener,noreferrer");
}

const TEMP_ASSISTANT_ID = "__streaming__";

const STARTERS = ["Where do I stand in this course?", "Drill my weak spots", "What should I review today?"];

type DonePayload = {
  messageId?: string;
  answerBasis?: AnswerBasis;
  citations?: Citation[];
  artifacts?: Array<{ id: string; kind: string; title: string; url: string }>;
  studySessionId?: string | null;
};

function toToolLine(data: Record<string, unknown>): ToolLine {
  const artifact =
    data.artifact && typeof data.artifact === "object"
      ? (data.artifact as { id?: unknown; kind?: unknown; title?: unknown; url?: unknown })
      : null;
  return {
    name: typeof data.name === "string" ? data.name : "tool",
    summary: typeof data.summary === "string" ? data.summary : "Used a course tool",
    artifact:
      artifact && typeof artifact.id === "string" && typeof artifact.url === "string"
        ? {
            id: artifact.id,
            kind: typeof artifact.kind === "string" ? artifact.kind : "artifact",
            title: typeof artifact.title === "string" ? artifact.title : "Course artifact",
            url: artifact.url,
          }
        : undefined,
    sessionId: typeof data.sessionId === "string" ? data.sessionId : null,
  };
}

/**
 * Course-level study companion. Separate conversations per course (notebook_id null),
 * persisted through the chat-repository pattern. Streams the final answer
 * after the server-side tool loop, cites only retrieved sources, and links
 * generated quizzes / decks to their course render view. Quiz and flashcard
 * generation live here — not in the notebook tutor.
 */
export function CourseChatSlot({ courseId }: { courseId: string }) {
  const inputId = useId();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CourseChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyRequest = useRef(0);
  const sending = useRef(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const threadsPanelRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadThreads() {
      try {
        for (let offset = 0; ; offset += 20) {
          const response = await fetch(`/api/course-chat/threads?courseId=${courseId}&offset=${offset}`, {
            cache: "no-store", signal: controller.signal,
          });
          if (!response.ok) throw new Error("Previous conversations could not be loaded.");
          const payload = (await response.json()) as { threads?: ChatThread[] };
          if (controller.signal.aborted) return;
          const page = payload.threads ?? [];
          setThreads((current) => [
            ...current, ...page.filter((thread) => !current.some((entry) => entry.id === thread.id)),
          ]);
          if (page.length < 20) break;
        }
      } catch (error) {
        if (!controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : "Previous conversations could not be loaded.");
      }
    }
    void loadThreads();
    return () => {
      controller.abort();
      historyRequest.current += 1;
    };
  }, [courseId]);

  const selectThread = async (threadId: string | null) => {
    if (sending.current) return;
    const request = ++historyRequest.current;
    setActiveThreadId(threadId);
    setMessages([]);
    setQuestion("");
    setStreamError(null);
    setHistoryError(null);
    setActionError(null);
    setHistoryLoading(Boolean(threadId));
    if (!threadId) return;
    try {
      const allMessages: ChatMessage[] = [];
      for (let offset = 0; ; offset += 50) {
        const response = await fetch(`/api/course-chat/threads/${threadId}/messages?offset=${offset}`, { cache: "no-store" });
        if (request !== historyRequest.current) return;
        if (!response.ok) throw new Error("This conversation could not be loaded. Select it again to retry.");
        const payload = (await response.json()) as { messages?: ChatMessage[] };
        const page = payload.messages ?? [];
        allMessages.push(...page);
        if (page.length < 50) break;
      }
      if (request === historyRequest.current) setMessages(allMessages);
    } catch (error) {
      if (request === historyRequest.current) setHistoryError(error instanceof Error ? error.message : "Chat history could not be loaded.");
    } finally {
      if (request === historyRequest.current) setHistoryLoading(false);
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, isAsking]);

  useEffect(() => {
    if (!threadsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (threadsPanelRef.current && !threadsPanelRef.current.contains(event.target as Node)) {
        setThreadsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setThreadsOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [threadsOpen]);

  const ask = useCallback(
    async (retryQuestion?: string) => {
      const text = (retryQuestion ?? question).trim();
      if (!text || sending.current || historyLoading || (activeThreadId && historyError)) return;
      sending.current = true;
      setIsAsking(true);
      setStreamError(null);
      setQuestion("");

      const userMessage: CourseChatMessage = {
        id: `temp-user-${Date.now()}`,
        threadId: activeThreadId ?? "pending",
        role: "user",
        content: text,
        citations: [],
        answerBasis: null,
      };
      const streamingMessage: CourseChatMessage = {
        id: TEMP_ASSISTANT_ID,
        threadId: activeThreadId ?? "pending",
        role: "assistant",
        content: "",
        citations: [],
        answerBasis: null,
        tools: [],
      };
      setMessages((current) => [...current, userMessage, streamingMessage]);

      try {
        const response = await fetch("/api/course-chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ courseId, threadId: activeThreadId, question: text }),
        });

        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? "The course chat could not answer.");
        }

        let donePayload: DonePayload | null = null;
        for await (const { event, data } of readServerEvents(response)) {
          if (event === "thread") {
            const threadId = typeof data.threadId === "string" ? data.threadId : null;
            if (threadId) {
              setActiveThreadId(threadId);
              setThreads((current) => {
                const existing = current.find((thread) => thread.id === threadId);
                return [{ id: threadId, courseId, notebookId: null, title: existing?.title ?? text.slice(0, 60), updatedAt: new Date().toISOString() },
                  ...current.filter((thread) => thread.id !== threadId)];
              });
            }
          } else if (event === "context") {
            const threadId = typeof data.threadId === "string" ? data.threadId : null;
            if (threadId && !activeThreadId) setActiveThreadId(threadId);
            setThreads((current) => {
              if (threadId && !current.some((thread) => thread.id === threadId)) {
                return [
                  { id: threadId, courseId, notebookId: null, title: text.slice(0, 60), updatedAt: new Date().toISOString() },
                  ...current,
                ];
              }
              return current;
            });
          } else if (event === "tool") {
            const line = toToolLine(data);
            if (line.artifact) window.dispatchEvent(new CustomEvent("course-artifacts-updated", { detail: { courseId } }));
            setMessages((current) =>
              current.map((message) =>
                message.id === TEMP_ASSISTANT_ID ? { ...message, tools: [...(message.tools ?? []), line] } : message,
              ),
            );
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
            donePayload = data as unknown as DonePayload;
          } else if (event === "error") {
            throw new Error(typeof data.message === "string" ? data.message : "The course chat could not answer.");
          }
        }

        if (!donePayload) throw new Error("The response ended before it finished. Please try again.");
        setMessages((current) =>
          current.map((message) =>
            message.id === TEMP_ASSISTANT_ID
              ? {
                  ...message,
                  id: donePayload?.messageId ?? `assistant-${Date.now()}`,
                  answerBasis: donePayload?.answerBasis ?? "general_knowledge",
                  citations: Array.isArray(donePayload?.citations) ? (donePayload.citations as Citation[]) : [],
                  artifacts: Array.isArray(donePayload?.artifacts) ? donePayload.artifacts : [],
                  sessionStarted: (donePayload?.studySessionId ?? null) !== null,
                }
              : message,
          ),
        );
      } catch (error) {
        setStreamError(error instanceof Error ? error.message : "The course chat could not answer.");
        setMessages((current) => current.filter((message) => message.id !== TEMP_ASSISTANT_ID && message.id !== userMessage.id));
        setQuestion(text);
      } finally {
        sending.current = false;
        setIsAsking(false);
      }
    },
    [activeThreadId, courseId, historyLoading, historyError, question],
  );

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

  const renderThreadsControls = (panelClassName: string) => (
    <div className="relative" ref={threadsPanelRef}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setThreadsOpen((current) => !current)}
          disabled={isAsking}
          aria-expanded={threadsOpen}
          aria-label="Previous conversations"
          title="Previous conversations"
          className="pressable inline-flex h-8 w-8 items-center justify-center border border-border bg-paper font-body text-text transition-colors hover:bg-bg-alt"
        >
          <Menu className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            setThreadsOpen(false);
            void selectThread(null);
          }}
          disabled={isAsking}
          aria-label="New chat"
          title="New chat"
          className="pressable inline-flex h-8 w-8 items-center justify-center border border-border bg-paper font-body text-text transition-colors hover:bg-bg-alt"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {threadsOpen ? (
        <div className={panelClassName}>
          <p className="border-b border-border px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
            Previous chats
          </p>
          {threads.length === 0 ? (
            <p className="px-3 py-3 font-body text-xs leading-5 text-text-dim">
              No previous conversations yet.
            </p>
          ) : (
            <ul className="py-1" aria-label="Course chat threads">
              {threads.map((thread) => (
                <li key={thread.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setThreadsOpen(false);
                      void selectThread(thread.id);
                    }}
                    disabled={isAsking}
                    aria-current={thread.id === activeThreadId ? "true" : undefined}
                    className={cn(
                      "pressable block w-full truncate px-3 py-2 text-left font-body text-[12px]! leading-4! font-medium transition-colors",
                      thread.id === activeThreadId
                        ? "bg-blue-tint text-text"
                        : "text-text-muted hover:bg-bg-alt hover:text-text",
                    )}
                    title={thread.title}
                  >
                    {thread.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );

  return (
    <section aria-label="Course chat" data-course-chat-slot={courseId} className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="flex items-center justify-start pb-3 pt-4">
        {renderThreadsControls("absolute left-0 top-full z-20 mt-2 max-h-72 w-72 overflow-y-auto border border-border bg-white shadow-lg")}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4" aria-live="polite">
        {historyError ? <p role="alert" className="mb-3 font-body text-sm text-[#a53f34]">{historyError}</p> : null}
        {historyLoading ? (
          <div role="status">
            <span className="sr-only">Loading conversation</span>
            <div className="flex flex-col space-y-4" aria-hidden="true">
              <div className="w-2/3 max-w-[85%] animate-pulse space-y-2 self-end border border-border bg-paper px-3.5 py-3">
                <div className="h-3 w-11/12 bg-border" />
                <div className="h-3 w-3/5 bg-border" />
              </div>
              <div className="w-3/4 max-w-[85%] animate-pulse self-start">
                <div className="flex items-center gap-1.5">
                  <div className="h-3.5 w-3.5 bg-border" />
                  <div className="h-3 w-24 bg-border" />
                </div>
                <div className="mt-2 space-y-2">
                  <div className="h-3 w-full bg-border" />
                  <div className="h-3 w-10/12 bg-border" />
                  <div className="h-3 w-2/3 bg-border" />
                </div>
              </div>
              <div className="w-1/2 max-w-[85%] animate-pulse space-y-2 self-end border border-border bg-paper px-3.5 py-3">
                <div className="h-3 w-full bg-border" />
                <div className="h-3 w-2/3 bg-border" />
              </div>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="mx-auto flex min-h-full w-full max-w-xl flex-col items-center justify-center py-10 text-center">
            <Sparkles className="h-7 w-7 text-text-dim" />
            <p className="mt-4 font-heading text-xl font-medium tracking-[-0.02em] text-text">
              What would you like to understand?
            </p>
            <p className="mt-2 max-w-md font-body text-sm leading-6 text-text-muted">
              Work through a tricky concept or connect ideas across your notebooks. When you're ready to practice,
              ask for a quiz or flashcards. You can find them later in the sidebar.
            </p>
            <div className="mt-6 w-full">
              <form onSubmit={submit} className="flex gap-2">
                <Input
                  id={inputId}
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ask about the course, or ask for a quiz"
                  aria-label="Ask the course chat"
                  disabled={isAsking}
                  className="h-12"
                />
                <button
                  type="submit"
                  disabled={isAsking || historyLoading || Boolean(activeThreadId && historyError) || !question.trim()}
                  className="pressable flex h-12 items-stretch overflow-hidden border border-blue bg-blue text-white transition-colors hover:bg-blue-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex flex-1 items-center justify-center whitespace-nowrap px-4 font-body text-sm font-medium">
                    {isAsking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "Ask"}
                  </span>
                  <span className="flex w-10 items-center justify-center border-l border-white/20">
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </button>
              </form>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1">
              {STARTERS.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  onClick={() => void ask(starter)}
                  disabled={isAsking}
                  className="pressable border border-border bg-paper px-2 py-1 font-body text-[10px] text-text-muted transition-colors hover:bg-bg-alt hover:text-text"
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="flex flex-col space-y-4">
            {messages.map((message) => (
              <li
                key={message.id}
                className={cn(
                  "w-fit max-w-[85%] px-3.5 py-3",
                  message.role === "user"
                    ? "self-end border border-border bg-paper"
                    : "self-start bg-transparent",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-text-dim">
                    {message.role === "user" ? <User className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {message.role === "user" ? "You" : "Course chat"}
                  </span>
                </div>
                {message.tools && message.tools.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {message.tools.map((tool, index) => (
                      <li key={`${tool.name}-${index}`} className="flex items-start gap-1.5 font-body text-xs leading-5 text-text-muted">
                        <Wrench className="mt-1 h-3 w-3 shrink-0 text-text-dim" />
                        <span className="min-w-0 flex-1">
                          {tool.summary}
                          {tool.artifact ? (
                            <>
                              {" · "}
                              <Link href={tool.artifact.url} className="pressable font-medium text-blue hover:underline">
                                Open {tool.artifact.title}
                              </Link>
                            </>
                          ) : null}
                          {tool.sessionId ? " · open Study Mode below to work it" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {message.role === "assistant" ? (
                  <div className="mt-2">
                    {!message.content && message.id === TEMP_ASSISTANT_ID ? (
                      <p role="status" className="thinking-shimmer font-body text-sm leading-6">
                        Thinking across your course...
                      </p>
                    ) : (
                      <ChatMarkdown text={message.content} />
                    )}
                  </div>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap font-body text-sm leading-6 text-text">{message.content}</p>
                )}
                {message.artifacts && message.artifacts.length > 0 ? (
                  <div className="mt-2.5 space-y-1.5 border-t border-border pt-2.5">
                    {message.artifacts.map((artifact) => (
                      <Link
                        key={artifact.id}
                        href={artifact.url}
                        className="pressable flex items-center gap-2 border border-blue/25 bg-blue/[0.06] px-3 py-2 font-body text-xs font-medium text-text transition-colors hover:bg-blue/[0.1]"
                      >
                        {artifact.kind === "video" ? <Video className="h-3.5 w-3.5 text-blue" /> : artifact.kind === "assessment" ? <ListChecks className="h-3.5 w-3.5 text-blue" /> : <Layers className="h-3.5 w-3.5 text-blue" />}
                        <span className="min-w-0 flex-1 truncate">{artifact.title}</span>
                        <span className="font-medium text-blue">Open</span>
                      </Link>
                    ))}
                  </div>
                ) : null}
                {message.sessionStarted ? (
                  <p className="mt-2.5 border border-border bg-paper px-3 py-2 font-body text-xs leading-5 text-text-muted">
                    A study session is ready — work it in Study Mode further down this page.
                  </p>
                ) : null}
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

      {messages.length === 0 && !historyLoading ? null : (
      <div className="px-5 py-4">
        <form onSubmit={submit} className="flex gap-2">
          <Input
            id={inputId}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask about the course, or ask for a quiz"
            aria-label="Ask the course chat"
            disabled={isAsking}
          />
          <button
            type="submit"
            disabled={isAsking || historyLoading || Boolean(activeThreadId && historyError) || !question.trim()}
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
      )}
    </section>
  );
}
