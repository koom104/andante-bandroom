-- Keep only the most recently registered push device for each user.
-- Run after supabase/patch-019-web-push-rpc.sql.

begin;

with ranked_subscriptions as (
  select
    id,
    row_number() over (
      partition by user_id
      order by updated_at desc, created_at desc, id desc
    ) as device_rank
  from public.push_subscriptions
  where disabled_at is null
)
update public.push_subscriptions ps
set disabled_at = now()
from ranked_subscriptions ranked
where ps.id = ranked.id
  and ranked.device_rank > 1;

create unique index if not exists push_subscriptions_one_active_per_user
on public.push_subscriptions (user_id)
where disabled_at is null;

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

  perform pg_advisory_xact_lock(hashtext(requester_id::text));

  update public.push_subscriptions
  set disabled_at = now()
  where user_id = requester_id
    and disabled_at is null
    and endpoint <> p_endpoint;

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

revoke all on function public.save_push_subscription(text, text, text, text) from public;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

commit;
