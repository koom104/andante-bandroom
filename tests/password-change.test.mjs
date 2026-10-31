import test from 'node:test';
import assert from 'node:assert/strict';
import { changeRequiredPassword } from '../app/api/auth/password-change.ts';

test('password update failure cannot clear the reset requirement', async () => {
  let cleared = false;
  const result = await changeRequiredPassword(async () => false, async () => { cleared = true; return true; });
  assert.equal(result, 'password_failed');
  assert.equal(cleared, false);
});

test('network failure cannot clear the reset requirement', async () => {
  let cleared = false;
  await assert.rejects(changeRequiredPassword(async () => { throw new Error('network'); }, async () => { cleared = true; return true; }));
  assert.equal(cleared, false);
});

test('reset requirement is cleared only after password update succeeds', async () => {
  const calls = [];
  const result = await changeRequiredPassword(async () => { calls.push('password'); return true; }, async () => { calls.push('clear'); return true; });
  assert.equal(result, 'ok');
  assert.deepEqual(calls, ['password', 'clear']);
});

test('failure to clear the reset requirement is reported as incomplete', async () => {
  assert.equal(await changeRequiredPassword(async () => true, async () => false), 'completion_failed');
});
