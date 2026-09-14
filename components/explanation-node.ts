import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { ExplanationBlockView } from "@/components/explanation-block-view";

/**
 * Custom Tiptap node for generated explanations. The document stores only
 * the artifact id plus a cached title/summary for first paint; the full
 * payload lives in `learning_artifacts` and hydrates through context.
 */
export const ExplanationNode = Node.create({
  name: "explanationBlock",

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
      summary: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-summary") ?? "",
        renderHTML: (attributes) => (attributes.summary ? { "data-summary": attributes.summary } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-explanation-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-explanation-block": "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ExplanationBlockView);
  },
});
