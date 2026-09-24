import test from 'node:test';
import assert from 'node:assert/strict';
import { updateDateScheduleDraft, buildDateScheduleRows } from '../app/date-schedule-drafts.ts';

test('editing another date preserves the first date and returning edits its draft', () => {
  let drafts = updateDateScheduleDraft({}, '2026-09-22', [], () => ['2026-09-22-10:00']);
  drafts = updateDateScheduleDraft(drafts, '2026-09-23', [], () => ['2026-09-23-11:00']);
  drafts = updateDateScheduleDraft(drafts, '2026-09-22', [], (current) => [...current, '2026-09-22-10:30']);
  assert.equal(Object.keys(drafts).length, 2);
  assert.deepEqual(drafts['2026-09-22'], ['2026-09-22-10:00', '2026-09-22-10:30']);
  assert.deepEqual(drafts['2026-09-23'], ['2026-09-23-11:00']);
});

test('reverting one date removes only that pending date', () => {
  const drafts = { '2026-09-22': [], '2026-09-23': ['2026-09-23-11:00'] };
  const next = updateDateScheduleDraft(drafts, '2026-09-22', ['2026-09-22-10:00'], () => ['2026-09-22-10:00']);
  assert.deepEqual(next, { '2026-09-23': ['2026-09-23-11:00'] });
  assert.equal(Object.keys(drafts).length, 2);
});

test('an empty draft overrides a busy weekly schedule as all available', () => {
  const drafts = updateDateScheduleDraft({}, '2026-09-22', ['2026-09-22-10:00'], () => []);
  const rows = buildDateScheduleRows(drafts, 'member', 'editor', ['10:00', '10:30'], 'timestamp');
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.is_busy === false));
});

test('one batch contains all slots for changed dates, without touching other dates', () => {
  const drafts = { '2026-09-22': ['2026-09-22-10:00'], '2026-09-23': [] };
  const rows = buildDateScheduleRows(drafts, 'member', 'admin', ['10:00', '10:30'], 'timestamp');
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => row.is_busy), [true, false, false, false]);
  assert.ok(rows.every((row) => row.user_id === 'member' && row.updated_by === 'admin'));
  assert.deepEqual([...new Set(rows.map((row) => row.schedule_date))], Object.keys(drafts));
});
