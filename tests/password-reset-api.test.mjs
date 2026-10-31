import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readBoundedJson } from '../app/api/bounded-json.ts';
import { changeRequiredPassword } from '../app/api/auth/password-change.ts';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const json = (body, init) => new Response(JSON.stringify(body), init);

function route({ validUser = true, pending = true, passwordOk = true, passwordStatus, returnedId = 'member', clearOk = true } = {}) {
  const writes = [];
  const exports = {};
  const dependencies = {
    '@supabase/supabase-js': { createClient: () => ({
      auth: { getUser: async () => ({ data: { user: validUser ? { id: 'member' } : null }, error: null }) },
      from: () => ({
        select() { return this; },
        eq(_column, value) { this.id = value; return this; },
        maybeSingle: async () => ({ data: { id: 'member', password_reset_required: pending }, error: null }),
        update(value) { writes.push({ type: 'clear', value }); return this; },
        async single() { writes.push({ type: 'target', id: this.id }); return { data: { id: 'member' }, error: clearOk ? null : {} }; },
      }),
    }) },
    'next/server': { NextResponse: { json } },
    '../../bounded-json': { readBoundedJson },
    '../../request-security': { rejectCrossOriginMutation: () => null },
    '../password-change': { changeRequiredPassword },
  };
  const compiled = ts.transpileModule(fs.readFileSync('app/api/auth/complete-password-reset/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports, require: name => { if (!(name in dependencies)) throw new Error(name); return dependencies[name]; },
    process: { env: { SUPABASE_SERVICE_ROLE_KEY: 'test-only' } }, AbortSignal,
    fetch: async (_url, options) => {
      assert.equal(options.redirect, 'manual', 'Workers must not follow redirects with the session token');
      writes.push({ type: 'password', value: JSON.parse(options.body) });
      return json({ id: returnedId }, { status: passwordStatus ?? (passwordOk ? 200 : 422) });
    },
  });
  return { post: exports.POST, writes };
}
function request(body = { password: 'different-password', userId: 'someone-else' }, token = 'session') {
  return new Request('https://example.com/api/auth/complete-password-reset', {
    method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body),
  });
}
test('missing or invalid session cannot change a password or clear the flag', async () => {
  for (const validUser of [true, false]) {
    const api = route({ validUser });
    assert.equal((await api.post(request(undefined, validUser ? '' : 'invalid'))).status, 401);
    assert.equal(api.writes.length, 0);
  }
});
test('password failure or mismatched authenticated user never clears the flag', async () => {
  for (const options of [{ passwordOk: false }, { returnedId: 'someone-else' }]) {
    const api = route(options);
    assert.equal((await api.post(request())).status, 503);
    assert.deepEqual(api.writes.map(write => write.type), ['password']);
  }
});
test('a successful password update clears only the session owner, ignoring supplied userId', async () => {
  const api = route();
  assert.equal((await api.post(request())).status, 200);
  assert.deepEqual(api.writes.map(write => write.type), ['password', 'clear', 'target']);
  assert.equal(api.writes[2].id, 'member');
});

test('an upstream redirect never counts as a successful password change', async () => {
  const api = route({ passwordStatus: 302 });
  assert.equal((await api.post(request())).status, 503);
  assert.deepEqual(api.writes.map(write => write.type), ['password']);
});
test('invalid passwords and non-reset accounts cannot start the update', async () => {
  const api = route();
  assert.equal((await api.post(request({ password: '' }))).status, 400);
  assert.equal(api.writes.length, 0);
  const ordinary = route({ pending: false });
  assert.equal((await ordinary.post(request())).status, 409);
  assert.equal(ordinary.writes.length, 0);
});
