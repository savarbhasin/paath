"use client";

import { createContext, useContext } from "react";

import type { ArtifactEnvelope } from "@/lib/contracts";

export type ArtifactWithStatus = ArtifactEnvelope & {
  status?: string;
  error?: string | null;
};

/** Merges a refreshed artifact (e.g. after Retry) into the editor's map. */
export type UpsertArtifact = (artifact: ArtifactWithStatus) => void;

export const ArtifactUpsertContext = createContext<UpsertArtifact>(() => undefined);

export function useUpsertArtifact(): UpsertArtifact {
  return useContext(ArtifactUpsertContext);
}
