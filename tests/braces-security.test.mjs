import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const braces = require('../node_modules/.pnpm/node_modules/braces');

test('patched braces preserves ordinary matching and expansion', () => {
  assert.deepEqual(braces.expand('song-{a,b}.txt'), ['song-a.txt', 'song-b.txt']);
  assert.equal(braces.compile('song-{a,b}.txt'), 'song-(a|b).txt');
});

test('deeply nested patterns are rejected before recursive walkers', () => {
  const pattern = '{'.repeat(2000) + 'a,b' + '}'.repeat(2000);
  for (const method of ['compile', 'expand', 'stringify']) {
    assert.throws(() => braces[method](braces.parse(pattern)), /safe nesting or node limit/);
  }
});

test('cyclic caller-supplied AST is rejected within a bounded number of steps', () => {
  const ast = { type: 'root', nodes: [] };
  ast.nodes.push(ast);
  assert.throws(() => braces.compile(ast), /safe nesting or node limit/);
});
