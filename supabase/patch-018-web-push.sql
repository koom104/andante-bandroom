-- Web Push notification subscriptions and send logs.
-- Run this in Supabase Dashboard > SQL Editor before enabling push notifications.

begin;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz
);

create table if not exists public.push_notification_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  booking_id uuid references public.bookings(id) on delete cascade,
  kind text not null check (kind in ('daily_digest', 'booking_reminder', 'booking_created', 'booking_cancelled')),
  notification_date date,
  created_at timestamptz not null default now()
);

create unique index if not exists push_notification_logs_booking_once
on public.push_notification_logs (user_id, booking_id, kind)
where booking_id is not null;

create unique index if not exists push_notification_logs_daily_once
on public.push_notification_logs (user_id, notification_date, kind)
where booking_id is null;

create index if not exists push_subscriptions_user_id_idx
on public.push_subscriptions (user_id)
where disabled_at is null;

create index if not exists push_notification_logs_created_at_idx
on public.push_notification_logs (created_at);

drop trigger if exists push_subscriptions_touch_updated_at on public.push_subscriptions;
create trigger push_subscriptions_touch_updated_at
before update on public.push_subscriptions
for each row execute function public.touch_updated_at();

alter table public.push_subscriptions enable row level security;
alter table public.push_notification_logs enable row level security;

drop policy if exists "push_subscriptions_select_self" on public.push_subscriptions;
create policy "push_subscriptions_select_self"
on public.push_subscriptions
for select
to authenticated
using (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "push_subscriptions_insert_self" on public.push_subscriptions;
create policy "push_subscriptions_insert_self"
on public.push_subscriptions
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "push_subscriptions_update_self" on public.push_subscriptions;
create policy "push_subscriptions_update_self"
on public.push_subscriptions
for update
to authenticated
using (user_id = auth.uid() or public.is_admin(auth.uid()))
with check (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "push_subscriptions_delete_self" on public.push_subscriptions;
create policy "push_subscriptions_delete_self"
on public.push_subscriptions
for delete
to authenticated
using (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "push_notification_logs_select_admin" on public.push_notification_logs;
create policy "push_notification_logs_select_admin"
on public.push_notification_logs
for select
to authenticated
using (public.is_admin(auth.uid()));

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.push_notification_logs to authenticated;

commit;
