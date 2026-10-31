import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const patch = readFileSync(new URL('../supabase/patch-039-annual-recap.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');

test('annual recap and detail history ignore leaderboard resets without altering stored data', () => {
  assert.doesNotMatch(patch, /rehearsal_tracking_settings|\b(delete|truncate|update|insert)\s/i);
  assert.match(patch, /create or replace function public.get_my_rehearsal_recap/);
  assert.match(patch, /create or replace function public.get_my_team_rehearsal_sessions/);
  assert.equal((patch.match(/booking_date >= make_date\(p_year, 1, 1\)/g) ?? []).length, 2);
  assert.equal((patch.match(/booking_date < make_date\(p_year \+ 1, 1, 1\)/g) ?? []).length, 2);
  assert.equal((patch.match(/bas.user_id = auth.uid\(\)/g) ?? []).length, 2);
  assert.equal((patch.match(/not public.is_approved\(auth.uid\(\)\)/g) ?? []).length, 2);
});

test('fresh installations use the same annual recap functions', () => {
  const latest = readFileSync(new URL('../supabase/patch-040-recap-performance-summary.sql', import.meta.url), 'utf8');
  const functions = latest.slice(latest.indexOf('create or replace function'), latest.lastIndexOf('commit;')).trim();
  assert.ok(schema.replaceAll('\r\n', '\n').includes(functions.replaceAll('\r\n', '\n')));
  const reset = schema.slice(schema.indexOf('create or replace function public.reset_rehearsal_tracking()'));
  assert.match(reset, /set count_from_date = excluded.count_from_date/);
});
