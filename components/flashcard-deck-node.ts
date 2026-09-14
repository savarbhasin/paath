import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { FlashcardDeckBlockView } from "@/components/flashcard-deck-block-view";

/**
 * Custom Tiptap node for generated flashcard decks. The document stores only
 * the artifact id plus cached title/subtitle; cards and review state live in
 * `learning_artifacts` + `flashcard_reviews` and hydrate through context.
 */
export const FlashcardDeckNode = Node.create({
  name: "flashcardDeckBlock",

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
    return [{ tag: "div[data-flashcard-deck-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-flashcard-deck-block": "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FlashcardDeckBlockView);
  },
});
