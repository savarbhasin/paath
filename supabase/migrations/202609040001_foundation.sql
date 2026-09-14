create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  color text not null default '#2d6a4f' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (workspace_id, title)
);

create table if not exists public.notebooks (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  content_json jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  type text not null check (type in ('file', 'pdf', 'youtube')),
  title text not null check (length(trim(title)) > 0),
  url text,
  storage_path text,
  supermemory_document_id text,
  status text not null default 'uploading' check (status in ('uploading', 'queued', 'processing', 'ready', 'failed', 'retrying')),
  error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (url is not null or storage_path is not null)
);

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  notebook_id uuid references public.notebooks(id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  citations_json jsonb not null default '[]'::jsonb,
  answer_basis text not null default 'general_knowledge' check (answer_basis in ('source', 'general_knowledge', 'mixed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.learning_artifacts (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  notebook_id uuid references public.notebooks(id) on delete set null,
  kind text not null check (kind in ('explanation', 'mermaid', 'image', 'flashcards', 'assessment', 'connection')),
  status text not null default 'pending' check (status in ('pending', 'generating', 'ready', 'failed')),
  payload_json jsonb not null default '{}'::jsonb,
  source_ids uuid[] not null default '{}',
  error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.flashcard_reviews (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.learning_artifacts(id) on delete cascade,
  card_id text not null,
  rating text not null check (rating in ('again', 'hard', 'good', 'easy')),
  reviewed_at timestamptz not null default timezone('utc', now()),
  next_review_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.learning_artifacts(id) on delete cascade,
  answers_json jsonb not null default '{}'::jsonb,
  results_json jsonb not null default '{}'::jsonb,
  score numeric(5, 4) not null check (score >= 0 and score <= 1),
  submitted_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.topic_mastery (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  topic_key text not null,
  label text not null,
  score numeric(5, 4) not null default 0 check (score >= 0 and score <= 1),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  last_practiced_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (course_id, topic_key)
);

create table if not exists public.misconceptions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  topic_key text not null,
  claim text not null,
  correction text not null,
  status text not null default 'active' check (status in ('active', 'resolved')),
  evidence_count integer not null default 1 check (evidence_count > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.learning_events (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  kind text not null check (kind in ('quiz_answer', 'quiz_complete', 'flashcard_review', 'misconception', 'preference', 'study_complete')),
  payload_json jsonb not null default '{}'::jsonb,
  memory_sync_status text not null default 'pending' check (memory_sync_status in ('pending', 'synced', 'failed')),
  memory_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  steps_json jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists courses_workspace_id_idx on public.courses(workspace_id);
create index if not exists workspaces_user_id_idx on public.workspaces(user_id);
create index if not exists notebooks_course_id_idx on public.notebooks(course_id);
create index if not exists sources_course_id_status_idx on public.sources(course_id, status);
create index if not exists chat_threads_course_id_idx on public.chat_threads(course_id);
create index if not exists chat_threads_notebook_id_idx on public.chat_threads(notebook_id);
create index if not exists chat_messages_thread_id_idx on public.chat_messages(thread_id, created_at);
create index if not exists learning_artifacts_course_id_idx on public.learning_artifacts(course_id);
create index if not exists learning_artifacts_notebook_id_idx on public.learning_artifacts(notebook_id);
create index if not exists flashcard_reviews_due_idx on public.flashcard_reviews(next_review_at);
create index if not exists quiz_attempts_artifact_id_idx on public.quiz_attempts(artifact_id, submitted_at);
create index if not exists topic_mastery_course_id_idx on public.topic_mastery(course_id, score);
create index if not exists misconceptions_course_id_status_idx on public.misconceptions(course_id, status);
create index if not exists learning_events_course_id_idx on public.learning_events(course_id, created_at);
create index if not exists study_sessions_course_id_status_idx on public.study_sessions(course_id, status);

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at before update on public.workspaces for each row execute function public.set_updated_at();
drop trigger if exists courses_set_updated_at on public.courses;
create trigger courses_set_updated_at before update on public.courses for each row execute function public.set_updated_at();
drop trigger if exists notebooks_set_updated_at on public.notebooks;
create trigger notebooks_set_updated_at before update on public.notebooks for each row execute function public.set_updated_at();
drop trigger if exists sources_set_updated_at on public.sources;
create trigger sources_set_updated_at before update on public.sources for each row execute function public.set_updated_at();
drop trigger if exists chat_threads_set_updated_at on public.chat_threads;
create trigger chat_threads_set_updated_at before update on public.chat_threads for each row execute function public.set_updated_at();
drop trigger if exists chat_messages_set_updated_at on public.chat_messages;
create trigger chat_messages_set_updated_at before update on public.chat_messages for each row execute function public.set_updated_at();
drop trigger if exists learning_artifacts_set_updated_at on public.learning_artifacts;
create trigger learning_artifacts_set_updated_at before update on public.learning_artifacts for each row execute function public.set_updated_at();
drop trigger if exists flashcard_reviews_set_updated_at on public.flashcard_reviews;
create trigger flashcard_reviews_set_updated_at before update on public.flashcard_reviews for each row execute function public.set_updated_at();
drop trigger if exists quiz_attempts_set_updated_at on public.quiz_attempts;
create trigger quiz_attempts_set_updated_at before update on public.quiz_attempts for each row execute function public.set_updated_at();
drop trigger if exists topic_mastery_set_updated_at on public.topic_mastery;
create trigger topic_mastery_set_updated_at before update on public.topic_mastery for each row execute function public.set_updated_at();
drop trigger if exists misconceptions_set_updated_at on public.misconceptions;
create trigger misconceptions_set_updated_at before update on public.misconceptions for each row execute function public.set_updated_at();
drop trigger if exists learning_events_set_updated_at on public.learning_events;
create trigger learning_events_set_updated_at before update on public.learning_events for each row execute function public.set_updated_at();
drop trigger if exists study_sessions_set_updated_at on public.study_sessions;
create trigger study_sessions_set_updated_at before update on public.study_sessions for each row execute function public.set_updated_at();

insert into public.workspaces (id, user_id, name)
values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'My learning space')
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values
  ('source-files', 'source-files', false),
  ('generated-images', 'generated-images', false)
on conflict (id) do update set public = excluded.public;
