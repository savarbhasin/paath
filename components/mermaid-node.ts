import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { MermaidBlockView } from "@/components/mermaid-block-view";

/**
 * Custom Tiptap node for generated Mermaid diagrams. The document stores only
 * the artifact id plus cached title/caption; the diagram code lives in
 * `learning_artifacts` and hydrates through context.
 */
export const MermaidNode = Node.create({
  name: "mermaidBlock",

  group: "block",

  atom: true,

  selectable: true,

  draggable: true,

  addAttributes() {
    return {
      artifactId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-artifact-id"),
        renderHTML: (attributes) =>
          attributes.artifactId ? { "data-artifact-id": attributes.artifactId } : {},
      },
      title: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-title") ?? "",
        renderHTML: (attributes) => (attributes.title ? { "data-title": attributes.title } : {}),
      },
      caption: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-caption") ?? "",
        renderHTML: (attributes) => (attributes.caption ? { "data-caption": attributes.caption } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-mermaid-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-mermaid-block": "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidBlockView);
  },
});
