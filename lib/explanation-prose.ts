import type { JSONContent } from "@tiptap/core";

import type { JsonValue, NotebookDocument } from "@/lib/domain";
import type { ExplanationPayload } from "@/lib/tutor";

/**
 * Converts a validated explanation payload into plain Tiptap document nodes
 * (paragraphs, headings, lists, quotes, code) so generated explanations flow
 * into the prose instead of a card. Only StarterKit node/mark types are
 * emitted. `[Sn]` provenance markers are ordinary text and pass through
 * untouched. Returns [] only when the payload holds no text at all.
 */
export function explanationToTiptapNodes(payload: ExplanationPayload): JSONContent[] {
  const nodes: JSONContent[] = [];
  const summary = payload.summary.trim();
  if (summary) {
    nodes.push({ type: "paragraph", content: inlineNodes(summary) });
  }
  for (const section of payload.sections) {
    const heading = section.heading.trim().slice(0, 120);
    if (heading) {
      nodes.push({
        type: "heading",
        attrs: { level: 3 },
        content: [{ type: "text", text: heading }],
      });
    }
    nodes.push(...blockNodes(section.markdown));
  }
  const example = payload.example?.trim();
  if (example) {
    nodes.push({
      type: "paragraph",
      content: [{ type: "text", text: "Example. ", marks: [{ type: "bold" }] }, ...inlineNodes(example)],
    });
  }
  return nodes;
}

/**
 * Strips legacy attributionLine blocks left by the retired provenance line:
 * the block is dropped, pending review marks come off as plain text (an
 * implicit accept — no visible content is lost), and everything else passes
 * through untouched. Applied to loaded documents so an unknown node type can
 * never break the editor.
 */
export function stripLegacyAttributionNodes(document: NotebookDocument): NotebookDocument {
  const content = Array.isArray(document.content) ? cleanNodes(document.content) : undefined;
  return content === undefined ? document : { ...document, content };
}

function cleanNodes(nodes: JsonValue[]): JsonValue[] {
  const cleaned: JsonValue[] = [];
  for (const node of nodes) {
    if (typeof node !== "object" || node === null || Array.isArray(node)) {
      cleaned.push(node);
      continue;
    }
    const record = node as Record<string, JsonValue>;
    if (record.type === "attributionLine") {
      continue;
    }
    let changed = false;
    const next: Record<string, JsonValue> = { ...record };
    const rawContent: JsonValue = record.content;
    if (Array.isArray(rawContent)) {
      const childContent = cleanNodes(rawContent);
      if (
        childContent.length !== rawContent.length ||
        childContent.some((child, index) => child !== rawContent[index])
      ) {
        next.content = childContent;
        changed = true;
      }
    }
    const rawMarks: JsonValue = record.marks;
    if (Array.isArray(rawMarks)) {
      const marks = rawMarks.filter(
        (mark) =>
          typeof mark !== "object" ||
          mark === null ||
          Array.isArray(mark) ||
          (mark as Record<string, JsonValue>).type !== "pendingInsert",
      );
      if (marks.length !== rawMarks.length) {
        next.marks = marks;
        changed = true;
      }
    }
    cleaned.push(changed ? next : node);
  }
  return cleaned;
}

function blockNodes(markdown: string): JSONContent[] {
  const nodes: JSONContent[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let index = 0;

  const flushParagraph = () => {
    const text = paragraph.join("\n").trim();
    paragraph = [];
    if (text) {
      nodes.push({ type: "paragraph", content: inlineNodes(text) });
    }
  };

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    // Fenced code block.
    if (/^```/.test(trimmed)) {
      flushParagraph();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1; // Skip the closing fence (or run past the end).
      const body = code.join("\n").slice(0, 4000);
      nodes.push({ type: "codeBlock", content: [{ type: "text", text: body || " " }] });
      continue;
    }

    // ATX heading — nested under the section title, so start at level 3.
    const headingMatch = /^(#{1,4})\s+(.*?)\s*$/.exec(trimmed);
    if (headingMatch) {
      flushParagraph();
      const level = Math.min(2 + headingMatch[1].length, 4);
      const text = headingMatch[2].trim().slice(0, 200);
      if (text) {
        nodes.push({ type: "heading", attrs: { level }, content: inlineNodes(text) });
      }
      index += 1;
      continue;
    }

    // Horizontal rule carries no content — drop it.
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      index += 1;
      continue;
    }

    // Quote block.
    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      const quoted: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoted.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      const text = quoted.join("\n").trim().slice(0, 2000);
      if (text) {
        nodes.push({ type: "blockquote", content: [{ type: "paragraph", content: inlineNodes(text) }] });
      }
      continue;
    }

    // List block (bullets and numbered items flattened in order).
    const listMatch = /^\s*(?:[-*+]|\d+[.)])\s+/.exec(line);
    if (listMatch) {
      flushParagraph();
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: JSONContent[] = [];
      while (index < lines.length) {
        const itemMatch = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(lines[index]);
        if (!itemMatch) break;
        const itemText = itemMatch[2].trim().slice(0, 1000);
        if (itemText) {
          items.push({ type: "listItem", content: [{ type: "paragraph", content: inlineNodes(itemText) }] });
        }
        index += 1;
      }
      if (items.length > 0) {
        nodes.push({ type: ordered ? "orderedList" : "bulletList", content: items });
      }
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      index += 1;
      continue;
    }

    paragraph.push(line);
    index += 1;
  }
  flushParagraph();
  return nodes;
}

type InlineMark = { type: "bold" } | { type: "italic" } | { type: "code" } | { type: "link"; attrs: { href: string } };

/**
 * Minimal inline parser for `code`, **bold**, *italic*, and [label](url).
 * Anything unrecognized stays literal text — never dropped.
 */
function inlineNodes(text: string): JSONContent[] {
  const content: JSONContent[] = [];
  // Split out code spans first so their contents are never reinterpreted.
  const codeParts = text.slice(0, 4000).split(/(`[^`\n]*`)/g);
  for (const part of codeParts) {
    if (!part) continue;
    if (/^`[^`\n]*`$/.test(part)) {
      const code = part.slice(1, -1);
      if (code) content.push({ type: "text", text: code, marks: [{ type: "code" }] });
      continue;
    }
    content.push(...richInlineNodes(part, []));
  }
  return content.length > 0 ? content : [{ type: "text", text: " " }];
}

function richInlineNodes(text: string, marks: InlineMark[]): JSONContent[] {
  const content: JSONContent[] = [];
  // Links: [label](href) — label itself is parsed for bold/italic.
  const linkPattern = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  const pushStyled = (segment: string, segmentMarks: InlineMark[]) => {
    content.push(...styledInlineNodes(segment, segmentMarks));
  };
  while ((match = linkPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      pushStyled(text.slice(cursor, match.index), marks);
    }
    const label = match[1].slice(0, 300);
    const href = match[2].slice(0, 500);
    if (label) {
      pushStyled(label, [...marks, { type: "link", attrs: { href } }]);
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    pushStyled(text.slice(cursor), marks);
  }
  return content;
}

function styledInlineNodes(text: string, marks: InlineMark[]): JSONContent[] {
  // Bold first, then italic inside each remainder.
  const boldPattern = /\*\*([^*][^*]*?)\*\*/g;
  const content: JSONContent[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = boldPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      content.push(...italicInlineNodes(text.slice(cursor, match.index), marks));
    }
    content.push(...italicInlineNodes(match[1], [...marks, { type: "bold" }]));
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    content.push(...italicInlineNodes(text.slice(cursor), marks));
  }
  return content;
}

function italicInlineNodes(text: string, marks: InlineMark[]): JSONContent[] {
  const italicPattern = /(?:\*([^*\n]+)\*|_([^_\n]+)_)/g;
  const content: JSONContent[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = italicPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      content.push({ type: "text", text: text.slice(cursor, match.index), ...(marks.length > 0 ? { marks } : {}) });
    }
    const inner = (match[1] ?? match[2] ?? "").slice(0, 1000);
    if (inner) {
      content.push({ type: "text", text: inner, marks: [...marks, { type: "italic" }] });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    content.push({ type: "text", text: text.slice(cursor), ...(marks.length > 0 ? { marks } : {}) });
  }
  return content.filter((node) => typeof node.text === "string" && node.text.length > 0);
}
