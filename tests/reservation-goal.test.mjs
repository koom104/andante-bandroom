import test from 'node:test';
import assert from 'node:assert/strict';
import {reservationDisplayGoal} from '../app/reservation-goal.ts';

test('reclassified teams display their current goal instead of the old booking goal',()=>{
  assert.equal(reservationDisplayGoal('기타','가을공연'),'기타');
  assert.equal(reservationDisplayGoal(' 기타 ','졸업 공연'),'기타');
});
test('missing teams or blank goals fall back to the stored booking goal',()=>{
  assert.equal(reservationDisplayGoal(undefined,'가을공연'),'가을공연');
  assert.equal(reservationDisplayGoal('  ','봄공연'),'봄공연');
});
test('imported history keeps its original performance goal and room blocks keep their own purpose',()=>{
  assert.equal(reservationDisplayGoal('기타','봄공연','notion_history'),'봄공연');
  assert.equal(reservationDisplayGoal('기타','행사 준비','booking','room_block'),'행사 준비');
  assert.equal(reservationDisplayGoal('기타','','booking','room_block'),'사용 제한');
});
