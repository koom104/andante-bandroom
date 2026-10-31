import test from 'node:test';
import assert from 'node:assert/strict';
import { sortGoalCategories } from '../app/goal-order.ts';

test('performance goals appear newest first, with spring and Daedong at the bottom', () => {
  const goals = ['대동제','여름공연','봄공연','가을공연','동연제','가을축제(총학생회)'].map(name=>({name}));
  assert.deepEqual(sortGoalCategories(goals).map(g=>g.name),['가을공연','가을축제(총학생회)','동연제','여름공연','봄공연','대동제']);
  assert.equal(goals[0].name,'대동제');
});
