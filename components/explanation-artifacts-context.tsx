"use client";

import { createContext, useContext } from "react";

import type { ArtifactEnvelope } from "@/lib/contracts";

export const ExplanationArtifactsContext = createContext<Map<string, ArtifactEnvelope>>(new Map());

export function useExplanationArtifacts(): Map<string, ArtifactEnvelope> {
  return useContext(ExplanationArtifactsContext);
}
