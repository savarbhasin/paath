import { mergeAttributes, Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { GeneratedImageBlockView } from "@/components/generated-image-block-view";

/**
 * Custom Tiptap node for generated images. The document stores only the
 * artifact id plus cached title/caption; bytes live in private Supabase
 * Storage and hydrate through a fresh signed URL per view.
 */
export const GeneratedImageNode = Node.create({
  name: "generatedImageBlock",

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
    return [{ tag: "div[data-generated-image-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-generated-image-block": "true" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(GeneratedImageBlockView);
  },
});
