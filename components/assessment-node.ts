import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { AssessmentBlockView } from "@/components/assessment-block-view";

/**
 * Custom Tiptap node for generated practice sets and quizzes. The document
 * stores only the artifact id plus cached title/subtitle; questions and
 * attempts live in `learning_artifacts` + `quiz_attempts` and hydrate
 * through context.
 */
export const AssessmentNode = Node.create({
  name: "assessmentBlock",

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
      subtitle: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-subtitle") ?? "",
        renderHTML: (attributes) => (attributes.subtitle ? { "data-subtitle": attributes.subtitle } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-assessment-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-assessment-block": "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AssessmentBlockView);
  },
});
