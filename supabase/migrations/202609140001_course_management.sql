alter table public.courses add column if not exists archived_at timestamptz;

create or replace function public.delete_notebook_with_artifacts(target_id uuid, target_course uuid)
returns void language plpgsql security invoker set search_path = public as $$
begin
  delete from learning_artifacts where notebook_id = target_id and course_id = target_course;
  delete from notebooks where id = target_id and course_id = target_course;
end;
$$;
revoke all on function public.delete_notebook_with_artifacts(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_notebook_with_artifacts(uuid, uuid) to service_role;
