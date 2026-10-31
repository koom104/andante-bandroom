import test from 'node:test';
import assert from 'node:assert/strict';
import { attachScheduleTouchEditing } from '../app/schedule-painting.ts';

function fixture(t) {
  class Element extends EventTarget {
    attributes = new Map();
    setAttribute(key, value) { this.attributes.set(key, value); }
    removeAttribute(key) { this.attributes.delete(key); }
    contains(value) { return cells.includes(value); }
  }
  const cells = Array.from({ length: 3 }, (_, i) => Object.assign(new Element(), { key: String(i), busy: i === 1, locked: i === 2, columnIndex: 0, time: `10:${i * 10}` }));
  const grid = new Element(), writes = [];
  const restores = [];
  for (const [key, value] of Object.entries({ Element, window: new EventTarget(), document: { elementFromPoint: x => cells[Math.floor(x / 20)] ?? null } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    restores.push(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dispose = attachScheduleTouchEditing(grid, element => cells.includes(element) ? element : null, (cell, busy) => { writes.push([cell.key, busy]); cell.busy = busy; });
  t.after(() => { dispose(); for (const restore of restores) restore(); });
  function send(type, { x = 0, y = 0, count = 1, cell = cells[0] } = {}) {
    const event = new Event(type, { cancelable: true });
    const touch = { identifier: 1, clientX: x, clientY: y };
    Object.defineProperties(event, { target: { value: cell }, touches: { value: type === 'touchend' ? [] : Array.from({ length: count }, () => touch) }, changedTouches: { value: [touch] } });
    grid.dispatchEvent(event); return event;
  }
  return { send, cells, writes, dispose };
}

test('a short tap flips a cell without a separate edit mode', t => {
  const { send, cells, writes } = fixture(t);
  send('touchstart'); send('touchend');
  send('touchstart'); send('touchend');
  assert.deepEqual(writes, [['0', true], ['0', false]]);
  assert.equal(cells[0].busy, false);
});
test('an ordinary vertical swipe scrolls without editing cells', t => {
  const { send, writes } = fixture(t);
  send('touchstart');
  assert.equal(send('touchmove', { y: 20 }).defaultPrevented, false);
  t.mock.timers.tick(300); send('touchend');
  assert.equal(writes.length, 0);
});
test('hold and drag paints one consistent state, skips locked cells and never flips revisited cells', t => {
  const { send, writes } = fixture(t);
  send('touchstart'); t.mock.timers.tick(220);
  assert.equal(send('touchmove', { x: 20 }).defaultPrevented, true);
  send('touchmove', { x: 0 }); send('touchmove', { x: 40 }); send('touchend');
  assert.deepEqual(writes, [['0', true], ['1', true]]);
});
test('multi-touch and unmount cancel pending edits', t => {
  const { send, writes, dispose } = fixture(t);
  send('touchstart'); send('touchmove', { count: 2 }); t.mock.timers.tick(300);
  send('touchstart'); dispose(); t.mock.timers.tick(300);
  assert.equal(writes.length, 0);
});
