-- Rename the second-guitar session to rhythm guitar without losing existing memberships.
-- Run once in Supabase Dashboard > SQL Editor.

begin;

alter table public.team_members
  drop constraint if exists team_members_session_check;

update public.team_members
set session = '리듬기타'
where session = '세컨기타';

alter table public.team_members
  add constraint team_members_session_check check (
    session in ('보컬', '리드기타', '리듬기타', '어쿠스틱', '베이스', '드럼', '피아노', '신디')
  );

commit;
