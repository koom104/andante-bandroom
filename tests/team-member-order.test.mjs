import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionDisplayOrder, sortTeamMembersBySession } from '../app/team-member-order.ts';

test('team display follows instrument order without changing source members', () => {
  const members = [...sessionDisplayOrder].reverse().map((role, id) => ({ role, id }));
  const original = structuredClone(members);
  assert.deepEqual(sortTeamMembersBySession(members).map(member => member.role), [...sessionDisplayOrder]);
  assert.deepEqual(members, original);
});
test('role aliases share the correct position, ties remain stable and unknown roles go last', () => {
  const members = ['기타 역할', '신디', '건반', '드럼', '베이스', '통기타', '일렉 리듬', '세컨기타', '일렉 리드', '보컬'].map(role => ({ role }));
  assert.deepEqual(sortTeamMembersBySession(members).map(member => member.role), ['보컬', '일렉 리드', '일렉 리듬', '세컨기타', '통기타', '베이스', '드럼', '건반', '신디', '기타 역할']);
});
