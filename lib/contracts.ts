export type Citation = {
  sourceId: string;
  title: string;
  excerpt?: string;
  /** Retrieval marker (S1, S2…) used for inline [S1]-style cites this turn. */
  marker?: string;
  locator?: {
    kind: "page" | "timestamp" | "section";
    value: string;
  };
};

export type ArtifactKind =
  | "explanation"
  | "mermaid"
  | "image"
  | "flashcards"
  | "assessment"
  | "connection";

export type ArtifactEnvelope = {
  id: string;
  kind: ArtifactKind;
  title: string;
  sourceIds: string[];
  topicKeys: string[];
  citations: Citation[];
  payload: unknown;
};
