import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * Marks AI-drafted prose awaiting review. Rendered with a subtle tint (see
 * `.pending-insert` in globals.css); the `pid` ties marked ranges to their
 * draft so accept/discard can find them after any edits. `origin`/`mode`
 * ride on the first marked span only (JSON round-trip; never rendered) so a
 * replaced passage can be restored on discard, even after a reload.
 */
export const PendingMark = Mark.create({
  name: "pendingInsert",

  addAttributes() {
    return {
      pid: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-pid"),
        renderHTML: (attributes) => (attributes.pid ? { "data-pid": attributes.pid } : {}),
      },
      origin: {
        default: "",
        parseHTML: () => "",
        renderHTML: () => ({}),
      },
      mode: {
        default: "insert_after",
        parseHTML: () => "insert_after",
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-pending-insert]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-pending-insert": "true", class: "pending-insert" })];
  },
});
