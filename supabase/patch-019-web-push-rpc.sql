-- Web Push helper RPCs.
-- Run this after supabase/patch-018-web-push.sql if push subscription or test notification shows permission errors.

begin;

create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth_key text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_id uuid := auth.uid();
begin
  if requester_id is null then
    raise exception '로그인이 필요합니다.';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = requester_id
      and status = 'approved'
  ) then
    raise exception '승인된 부원만 알림을 받을 수 있습니다.';
  end if;

  insert into public.push_subscriptions (
    user_id,
    endpoint,
    p256dh,
    auth_key,
    user_agent,
    updated_at,
    disabled_at
  )
  values (
    requester_id,
    p_endpoint,
    p_p256dh,
    p_auth_key,
    coalesce(p_user_agent, ''),
    now(),
    null
  )
  on conflict (endpoint) do update
  set user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth_key = excluded.auth_key,
      user_agent = excluded.user_agent,
      updated_at = now(),
      disabled_at = null;
end;
$$;

create or replace function public.get_my_push_subscriptions()
returns table (
  id uuid,
  user_id uuid,
  endpoint text,
  p256dh text,
  auth_key text
)
language sql
stable
security definer
set search_path = public
as $$
  select ps.id, ps.user_id, ps.endpoint, ps.p256dh, ps.auth_key
  from public.push_subscriptions ps
  where ps.user_id = auth.uid()
    and ps.disabled_at is null
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.status = 'approved'
    );
$$;

create or replace function public.disable_my_push_subscription(p_subscription_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.push_subscriptions
  set disabled_at = now()
  where id = p_subscription_id
    and user_id = auth.uid();
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public;
revoke all on function public.get_my_push_subscriptions() from public;
revoke all on function public.disable_my_push_subscription(uuid) from public;

grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.get_my_push_subscriptions() to authenticated;
grant execute on function public.disable_my_push_subscription(uuid) to authenticated;

commit;
