-- Add bass as a selectable team member session.
-- Run this once in the Supabase SQL Editor before using 베이스 in team creation.

alter table public.team_members
  drop constraint if exists team_members_session_check;

alter table public.team_members
  add constraint team_members_session_check check (
    session in ('보컬', '리드기타', '세컨기타', '어쿠스틱', '베이스', '드럼', '피아노', '신디')
  );
