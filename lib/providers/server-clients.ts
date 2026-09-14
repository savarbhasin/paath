import "server-only";

import { getFireworksConfig, getOpenAIConfig, getSupermemoryConfig } from "@/lib/config";

export function getSupermemoryServerConfig() {
  const config = getSupermemoryConfig();
  return { apiKey: config.SUPERMEMORY_API_KEY };
}

export function getOpenAIServerConfig() {
  const config = getOpenAIConfig();
  return {
    apiKey: config.OPENAI_API_KEY,
    imageModel: config.OPENAI_IMAGE_MODEL,
  };
}

export function getFireworksServerConfig() {
  const config = getFireworksConfig();
  return {
    apiKey: config.FIREWORKS_API_KEY,
    textModel: config.FIREWORKS_TEXT_MODEL,
  };
}
