import { z } from "zod";

/** Private Storage bucket holding rendered course videos and captions. */
export const VIDEO_BUCKET = "course-videos";

/** Lifecycle stage persisted in the versioned video payload. */
export const videoStageSchema = z.enum([
  "queued",
  "writing_script",
  "creating_visuals",
  "rendering",
  "ready",
  "failed",
]);

export type VideoStage = z.infer<typeof videoStageSchema>;

const videoCitationSchema = z.object({
  sourceId: z.string().min(1).max(100),
  title: z.string().min(1).max(300),
  excerpt: z.string().max(2000).optional(),
  locator: z
    .object({
      kind: z.enum(["page", "timestamp", "section"]),
      value: z.string().min(1).max(200),
    })
    .optional(),
});

/**
 * Versioned payload stored in `learning_artifacts.payload_json` for
 * `kind = 'video'` rows. Only storage object keys are persisted — never
 * expiring signed URLs; playback URLs are issued per request after
 * course/workspace checks.
 */
export const videoPayloadSchema = z.object({
  version: z.literal(1),
  title: z.string().trim().min(1).max(200),
  topic: z.string().trim().min(1).max(200),
  stage: videoStageSchema,
  transcript: z.string().max(20000).optional(),
  captionsKey: z.string().trim().min(1).max(500).optional(),
  videoKey: z.string().trim().min(1).max(500).optional(),
  durationSeconds: z.number().positive().max(3600).optional(),
  citations: z.array(videoCitationSchema).max(12).optional(),
  error: z.string().max(2000).optional(),
});

export type VideoPayload = z.infer<typeof videoPayloadSchema>;
