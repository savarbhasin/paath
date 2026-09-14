"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";

/** Model-written chat Markdown rendered with app type styles. Raw HTML is
 *  never rendered (react-markdown default). Shared by the notebook tutor and
 *  the course chat so responses never show raw `**` or `-` markers. */
const chatMarkdownComponents: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-6">{children}</li>,
  code: ({ children }) => <code className="bg-bg-alt px-1 font-mono text-[13px]">{children}</code>,
  h1: ({ children }) => <p className="mb-1 mt-3 font-body text-sm font-semibold first:mt-0">{children}</p>,
  h2: ({ children }) => <p className="mb-1 mt-3 font-body text-sm font-semibold first:mt-0">{children}</p>,
  h3: ({ children }) => <p className="mb-1 mt-2 font-body text-sm font-semibold first:mt-0">{children}</p>,
  h4: ({ children }) => <p className="mb-1 mt-2 font-body text-sm font-semibold first:mt-0">{children}</p>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-blue hover:underline">
      {children}
    </a>
  ),
};

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="font-body text-sm leading-6 text-text">
      <ReactMarkdown
        components={chatMarkdownComponents}
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
