-- Deploy the new password-reset API and frontend before running this patch.
-- This preserves all bookings and schedules.
begin;

create or replace function public.complete_password_reset()
returns void language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Use the authenticated password reset API';
end;
$$;
revoke all on function public.complete_password_reset() from public, anon, authenticated;

create or replace function public.is_approved(user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = user_id and status = 'approved' and not password_reset_required
  );
$$;

create or replace function public.is_admin(user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = user_id and role in ('admin', 'manager')
      and status = 'approved' and not password_reset_required
  );
$$;

create or replace function public.is_super_admin(user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = user_id and role = 'admin'
      and status = 'approved' and not password_reset_required
  );
$$;

commit;
