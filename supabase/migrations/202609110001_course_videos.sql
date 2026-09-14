-- Course teaching videos (Hyperframes local prototype): durable video_jobs
-- table, 'video' artifact kind, private storage bucket, and service-role-only
-- RPCs for atomic enqueue, leased claiming with attempt fencing, heartbeat
-- updates, and retry of failed jobs.

-- 1. Allow video artifacts. The foundation migration created this check
-- inline, so Postgres auto-named it learning_artifacts_kind_check.
alter table public.learning_artifacts drop constraint if exists learning_artifacts_kind_check;
alter table public.learning_artifacts
  add constraint learning_artifacts_kind_check
  check (kind in ('explanation', 'mermaid', 'image', 'flashcards', 'assessment', 'connection', 'video'));

-- 2. Durable job table. One row per video request; the worker claims rows
-- with a lease and fences writes by attempt token.
create table if not exists public.video_jobs (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.learning_artifacts(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  topic text not null check (length(trim(topic)) > 0),
  context_json jsonb not null default '{}'::jsonb,
  stage text not null default 'queued'
    check (stage in ('queued', 'writing_script', 'creating_visuals', 'rendering', 'ready', 'failed')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'ready', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  checkpoint_json jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists video_jobs_claim_idx
  on public.video_jobs(status, lease_expires_at, created_at);
-- One job row per artifact: retry re-queues in place, never duplicates.
create unique index if not exists video_jobs_artifact_id_uidx
  on public.video_jobs(artifact_id);
create index if not exists video_jobs_course_id_idx
  on public.video_jobs(course_id);

drop trigger if exists video_jobs_set_updated_at on public.video_jobs;
create trigger video_jobs_set_updated_at
  before update on public.video_jobs
  for each row execute function public.set_updated_at();

-- 3. Lock the jobs table down: service_role (used by the admin client and
-- the local worker) bypasses RLS; no policies are created so no other role
-- can read or write job rows.
alter table public.video_jobs enable row level security;

-- 4. Private storage bucket for rendered MP4s, captions, and posters.
insert into storage.buckets (id, name, public)
values ('course-videos', 'course-videos', false)
on conflict (id) do update set public = excluded.public;

-- 5. Atomic enqueue: deduplicates retries of the same chat tool invocation
-- (matching requestKey inside the grounding snapshot) and otherwise inserts
-- the learning_artifact + video_jobs rows in one transaction.
create or replace function public.enqueue_video_job(
  p_course_id uuid,
  p_topic text,
  p_title text,
  p_payload jsonb,
  p_context jsonb,
  p_request_key text default null
)
returns table (job_id uuid, artifact_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
  v_artifact_id uuid;
  v_context jsonb := coalesce(p_context, '{}'::jsonb);
  v_source_ids uuid[] := '{}';
begin
  -- Serialize concurrent enqueues carrying the same chat-tool request key so
  -- exactly one job+artifact pair is created per invocation.
  if p_request_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_course_id::text || p_request_key, 0));
    -- The RPC is authoritative for the dedup marker: inject requestKey into
    -- the stored grounding snapshot regardless of what the caller passed.
    v_context := v_context || jsonb_build_object('requestKey', p_request_key);
    -- Reuse the existing pair across ALL statuses (queued, running, ready,
    -- failed): retry of a finished invocation returns its artifact link, and
    -- explicit retry of failures goes through retry_video_job.
    select j.id, j.artifact_id into v_job_id, v_artifact_id
    from public.video_jobs as j
    where j.course_id = p_course_id
      and (j.context_json ->> 'requestKey') = p_request_key
    order by j.created_at desc
    limit 1;
    if v_job_id is not null then
      job_id := v_job_id;
      artifact_id := v_artifact_id;
      return next;
      return;
    end if;
  end if;

  -- Populate artifact source_ids from validated course-owned context
  -- sourceIds; unknown or cross-course ids are dropped. Citations stay in
  -- the versioned payload (written by the worker), not here.
  if jsonb_typeof(v_context -> 'sourceIds') = 'array' then
    select coalesce(array_agg(src.id), '{}')
    into v_source_ids
    from public.sources as src
    where src.course_id = p_course_id
      and src.id in (
        select (elem #>> '{}')::uuid
        from jsonb_array_elements(v_context -> 'sourceIds') as elem
        where (elem #>> '{}') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      );
  end if;

  insert into public.learning_artifacts (course_id, notebook_id, kind, status, payload_json, source_ids, error)
  values (p_course_id, null, 'video', 'generating', coalesce(p_payload, '{}'::jsonb), v_source_ids, null)
  returning id into v_artifact_id;

  insert into public.video_jobs (artifact_id, course_id, topic, context_json, stage, status)
  values (
    v_artifact_id,
    p_course_id,
    p_topic,
    v_context,
    'queued',
    'queued'
  )
  returning id into v_job_id;

  job_id := v_job_id;
  artifact_id := v_artifact_id;
  return next;
end;
$$;

-- 6. Leased claim: picks the oldest queued job, or a running job whose lease
-- expired (worker died), bumps attempts, and mints a fencing token.
create or replace function public.claim_video_job(p_lease_seconds integer default 120)
returns setof public.video_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lease integer := greatest(coalesce(p_lease_seconds, 120), 10);
begin
  -- Retire crash-loop jobs after three claimed attempts so one poison job
  -- cannot starve later work. Explicit learner retry resets the budget.
  with exhausted as (
    update public.video_jobs as j
    set status = 'failed', stage = 'failed',
        last_error = 'The worker was interrupted three times. Check the local worker and retry.',
        lease_token = null, lease_expires_at = null
    where j.status = 'running' and j.attempts >= 3
      and (j.lease_expires_at is null or j.lease_expires_at <= now())
    returning j.artifact_id
  )
  update public.learning_artifacts as a
  set status = 'failed',
      error = 'The worker was interrupted three times. Check the local worker and retry.',
      payload_json = a.payload_json || jsonb_build_object('stage', 'failed', 'error', 'The worker was interrupted three times. Check the local worker and retry.')
  from exhausted as e where a.id = e.artifact_id;

  return query
  with candidate as (
    select j.id
    from public.video_jobs as j
    where j.status = 'queued'
       or (j.status = 'running' and (j.lease_expires_at is null or j.lease_expires_at < now()))
    order by j.created_at asc
    limit 1
    for update skip locked
  )
  update public.video_jobs as j
  set status = 'running',
      attempts = j.attempts + 1,
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + (v_lease || ' seconds')::interval,
      updated_at = timezone('utc', now())
  from candidate
  where j.id = candidate.id
  returning j.*;
end;
$$;

-- 7. Heartbeat / progress update with fencing: only the holder of the
-- current lease token may write. When a payload is supplied the artifact
-- payload is replaced and the artifact status follows the job status
-- (ready -> ready, failed -> failed, otherwise generating).
create or replace function public.update_video_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_stage text,
  p_checkpoint jsonb,
  p_payload jsonb default null,
  p_status text default 'running',
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_artifact_id uuid;
  v_artifact_status text;
begin
  if p_stage not in ('queued', 'writing_script', 'creating_visuals', 'rendering', 'ready', 'failed') then
    raise exception 'Unknown video stage: %', p_stage;
  end if;
  if p_status not in ('queued', 'running', 'ready', 'failed') then
    raise exception 'Unknown video job status: %', p_status;
  end if;

  -- Fencing: only the current lease holder may write, and only while the
  -- job is still running on an unexpired lease. A late heartbeat from a
  -- superseded or expired attempt can never resurrect a finished job.
  update public.video_jobs as j
  set stage = p_stage,
      status = p_status,
      checkpoint_json = coalesce(p_checkpoint, j.checkpoint_json),
      last_error = p_error,
      lease_expires_at = now() + interval '120 seconds',
      updated_at = timezone('utc', now())
  where j.id = p_job_id
    and j.lease_token = p_lease_token
    and j.status = 'running'
    and j.lease_expires_at > now()
  returning j.artifact_id into v_artifact_id;

  if v_artifact_id is null then
    return false;
  end if;

  v_artifact_status := case
    when p_status = 'ready' then 'ready'
    when p_status = 'failed' then 'failed'
    else 'generating'
  end;

  if p_payload is not null then
    update public.learning_artifacts
    set payload_json = p_payload,
        status = v_artifact_status,
        error = p_error,
        updated_at = timezone('utc', now())
    where id = v_artifact_id;
  else
    update public.learning_artifacts
    set status = v_artifact_status,
        error = p_error,
        updated_at = timezone('utc', now())
    where id = v_artifact_id;
  end if;

  return true;
end;
$$;

-- 8. Retry: re-queues only failed jobs, preserving the checkpoint snapshot so
-- the worker resumes from the last valid stage. Same artifact row is kept so
-- the sidebar link never duplicates.
create or replace function public.retry_video_job(p_artifact_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  update public.video_jobs
  set status = 'queued',
      stage = 'queued',
      attempts = 0,
      lease_token = null,
      lease_expires_at = null,
      last_error = null,
      updated_at = timezone('utc', now())
  where artifact_id = p_artifact_id
    and status = 'failed'
  returning id into v_job_id;

  if v_job_id is null then
    return false;
  end if;

  update public.learning_artifacts
  set status = 'generating',
      error = null,
      -- Reset the payload lifecycle alongside the job so the player shows
      -- Queued instead of retaining the failed stage/error; checkpoint and
      -- media keys are preserved for resume.
      payload_json = (coalesce(payload_json, '{}'::jsonb) || '{"stage":"queued"}'::jsonb) - 'error',
      updated_at = timezone('utc', now())
  where id = p_artifact_id;

  return true;
end;
$$;

-- 9. RPCs are service_role only: the app and the local worker both use the
-- service-role admin client. Revoke from public/anon/authenticated.
revoke all on function public.enqueue_video_job(uuid, text, text, jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.claim_video_job(integer) from public, anon, authenticated;
revoke all on function public.update_video_job(uuid, uuid, text, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.retry_video_job(uuid) from public, anon, authenticated;
grant all on function public.enqueue_video_job(uuid, text, text, jsonb, jsonb, text) to service_role;
grant all on function public.claim_video_job(integer) to service_role;
grant all on function public.update_video_job(uuid, uuid, text, jsonb, jsonb, text, text) to service_role;
grant all on function public.retry_video_job(uuid) to service_role;
