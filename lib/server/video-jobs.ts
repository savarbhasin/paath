import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { VIDEO_BUCKET, videoPayloadSchema, type VideoPayload } from "@/lib/video";

export { VIDEO_BUCKET };

export type EnqueueVideoInput = {
  courseId: string;
  topic: string;
  /** Deduplicates retries of the same chat tool invocation. */
  requestKey?: string | null;
  /** Arbitrary JSON grounding snapshot saved on the job row. */
  context?: Record<string, unknown> | null;
};

export type EnqueuedVideo = {
  id: string;
  kind: "video";
  title: string;
  url: string;
};

type EnqueueRpcRow = { job_id: string; artifact_id: string };

/**
 * Persists a video request: creates the `learning_artifacts` row (kind
 * 'video', status 'generating') and its `video_jobs` row atomically via the
 * `enqueue_video_job` RPC. Returns immediately with a saved artifact link;
 * the local worker claims and renders the job asynchronously.
 */
export async function enqueueVideo(
  client: SupabaseClient,
  input: EnqueueVideoInput,
): Promise<EnqueuedVideo> {
  const topic = input.topic.trim().slice(0, 200);
  if (!topic) throw new Error("A topic is required to create a video.");
  const title = `Video · ${topic}`.slice(0, 200);

  const payload: VideoPayload = videoPayloadSchema.parse({
    version: 1,
    title,
    topic,
    stage: "queued",
  });

  // requestKey is echoed here for readability; the RPC authoritatively
  // injects it into the stored grounding snapshot and serializes
  // concurrent same-key enqueues with an advisory lock.
  const context: Record<string, unknown> = {
    ...(input.context ?? {}),
    ...(input.requestKey ? { requestKey: input.requestKey } : {}),
  };

  const { data, error } = await client.rpc("enqueue_video_job", {
    p_course_id: input.courseId,
    p_topic: topic,
    p_title: title,
    p_payload: payload,
    p_context: context,
    p_request_key: input.requestKey ?? null,
  });
  if (error) throw new Error(`The video could not be queued: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as EnqueueRpcRow | null | undefined;
  const artifactId = row?.artifact_id;
  if (!artifactId) throw new Error("The video could not be queued: empty response.");

  return {
    id: artifactId,
    kind: "video",
    title,
    url: `/courses/${input.courseId}/videos/${artifactId}`,
  };
}
