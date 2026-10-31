-- New signups always require approval; an email address never grants admin rights.
-- Existing profiles, approvals and administrator roles are not changed.
begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  has_privacy_consent boolean := coalesce(new.raw_user_meta_data ->> 'privacy_consent', '') = 'true';
begin
  if not has_privacy_consent then
    raise exception 'privacy consent required';
  end if;

  insert into public.profiles (
    id, email, name, cohort, student_no, role, status, approved_at,
    privacy_consent_at, privacy_consent_version
  )
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), '이름 미입력'),
    coalesce(nullif(new.raw_user_meta_data ->> 'cohort', ''), '-'),
    coalesce(nullif(new.raw_user_meta_data ->> 'student_no', ''), '-'),
    'member', 'pending', null,
    now(),
    nullif(new.raw_user_meta_data ->> 'privacy_consent_version', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Trigger execution does not require granting clients direct execution.
revoke all on function public.handle_new_user() from public, anon, authenticated;

commit;
