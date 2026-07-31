-- Require existing users to record the current privacy consent version.
-- This patch also includes the new-signup consent changes from patch-032.
begin;

alter table public.profiles
  add column if not exists privacy_consent_at timestamptz,
  add column if not exists privacy_consent_version text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_owner boolean := lower(coalesce(new.email, '')) = 'k91372960@gmail.com';
  has_privacy_consent boolean := coalesce(new.raw_user_meta_data ->> 'privacy_consent', '') = 'true';
begin
  if not is_owner and not has_privacy_consent then
    raise exception 'privacy consent required';
  end if;

  insert into public.profiles (
    id,
    email,
    name,
    cohort,
    student_no,
    role,
    status,
    approved_at,
    privacy_consent_at,
    privacy_consent_version
  )
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), '이름 미입력'),
    coalesce(nullif(new.raw_user_meta_data ->> 'cohort', ''), '-'),
    coalesce(nullif(new.raw_user_meta_data ->> 'student_no', ''), '-'),
    case when is_owner then 'admin' else 'member' end,
    case when is_owner then 'approved' else 'pending' end,
    case when is_owner then now() else null end,
    case when has_privacy_consent then now() else null end,
    case
      when has_privacy_consent
        then nullif(new.raw_user_meta_data ->> 'privacy_consent_version', '')
      else null
    end
  )
  on conflict (id) do update
    set email = excluded.email;

  return new;
end;
$$;

create or replace function public.accept_privacy_consent()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  accepted_at timestamptz := now();
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  update public.profiles
  set privacy_consent_at = accepted_at,
      privacy_consent_version = '2026-07-31-v1'
  where id = auth.uid();

  if not found then
    raise exception 'profile not found';
  end if;

  return accepted_at;
end;
$$;

revoke all on function public.accept_privacy_consent() from public;
grant execute on function public.accept_privacy_consent() to authenticated;

commit;
