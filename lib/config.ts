import "server-only";

import { z } from "zod";

const supabaseEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const supermemoryEnvSchema = z.object({
  SUPERMEMORY_API_KEY: z.string().min(1),
});

const openAIEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_IMAGE_MODEL: z.string().min(1).default("gpt-image-1"),
});

const fireworksEnvSchema = z.object({
  FIREWORKS_API_KEY: z.string().min(1),
  FIREWORKS_TEXT_MODEL: z.string().min(1).default("accounts/fireworks/models/minimax-m3"),
});

export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";
export const DEMO_WORKSPACE_ID = "00000000-0000-4000-8000-000000000002";
export const SOURCE_BUCKET = "source-files";
export const GENERATED_IMAGE_BUCKET = "generated-images";

export type SupabaseConfig = z.infer<typeof supabaseEnvSchema>;
export type SupermemoryConfig = z.infer<typeof supermemoryEnvSchema>;
export type OpenAIConfig = z.infer<typeof openAIEnvSchema>;
export type FireworksConfig = z.infer<typeof fireworksEnvSchema>;

let cachedSupabaseConfig: SupabaseConfig | undefined;
let cachedSupermemoryConfig: SupermemoryConfig | undefined;
let cachedOpenAIConfig: OpenAIConfig | undefined;
let cachedFireworksConfig: FireworksConfig | undefined;

function parseConfig<T>(schema: z.ZodType<T>, label: string): T {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid ${label} configuration. Check: ${missing}`);
  }
  return parsed.data;
}

export function getSupabaseConfig(): SupabaseConfig {
  if (!cachedSupabaseConfig) {
    cachedSupabaseConfig = parseConfig(supabaseEnvSchema, "Supabase");
  }
  return cachedSupabaseConfig;
}

export function getSupermemoryConfig(): SupermemoryConfig {
  if (!cachedSupermemoryConfig) {
    cachedSupermemoryConfig = parseConfig(supermemoryEnvSchema, "Supermemory");
  }
  return cachedSupermemoryConfig;
}

export function getOpenAIConfig(): OpenAIConfig {
  if (!cachedOpenAIConfig) {
    cachedOpenAIConfig = parseConfig(openAIEnvSchema, "OpenAI");
  }
  return cachedOpenAIConfig;
}

export function getFireworksConfig(): FireworksConfig {
  if (!cachedFireworksConfig) {
    cachedFireworksConfig = parseConfig(fireworksEnvSchema, "Fireworks");
  }
  return cachedFireworksConfig;
}
