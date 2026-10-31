import test from 'node:test';
import assert from 'node:assert/strict';
import { restoredTab, isAccountChange } from '../app/session-navigation.ts';

test('refocusing or refreshing tokens for the same account does not reset navigation', () => {
  assert.equal(isAccountChange('member', 'member'), false);
  assert.equal(isAccountChange('member', null), false);
  assert.equal(isAccountChange(null, 'member'), true);
  assert.equal(isAccountChange('member', 'other'), true);
});
test('a restarted app restores only a known tab', () => {
  for (const tab of ['my', 'calendar', 'recap']) assert.equal(restoredTab(tab), tab);
  for (const value of [null, '', 'other', '__proto__']) assert.equal(restoredTab(value), 'booking');
});
