import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { readBoundedJson } from '../app/api/bounded-json.ts';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const endpoint = 'https://web.push.apple.com/device-one';
const json = (value, init) => new Response(JSON.stringify(value), init);
const keys = { p256dh: 'a'.repeat(87), auth: 'b'.repeat(22) };

function api({ active = { id: 's1', endpoint, p256dh: keys.p256dh, auth_key: keys.auth }, valid = true, approved = true, changed = false } = {}) {
  const writes = [], filters = [];
  const exports = {};
  const client = {
    auth: { getUser: async () => ({ data: { user: valid ? { id: 'member' } : null } }) },
    rpc: async (name, body) => {
      if (name === 'save_push_subscription') { writes.push(body); return { error: null }; }
      return { data: active ? [active] : [], error: null };
    },
    from: (table) => ({
      select() { return table === 'profiles' ? this : Promise.resolve({ data: changed ? [] : [{ id: 's1' }], error: null }); },
      eq(column, value) { filters.push([column, value]); return this; },
      is(column, value) { filters.push([column, value]); return this; },
      update(value) { writes.push(value); return this; },
      maybeSingle: async () => ({ data: { id: 'member', status: approved ? 'approved' : 'pending' }, error: null }),
    }),
  };
  const deps = {
    '@supabase/supabase-js': { createClient: () => client },
    'next/server': { NextResponse: { json } },
    '../../../push-utils': { isValidWebPushSubscription: () => true },
    '../../request-security': { rejectCrossOriginMutation: () => null },
    '../../bounded-json': { readBoundedJson },
  };
  const compiled = ts.transpileModule(fs.readFileSync('app/api/push/subscribe/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(compiled, { exports, require: name => deps[name], process: { env: { SUPABASE_SERVICE_ROLE_KEY: 'test-only' } } });
  return { post: (body) => exports.POST(new Request('https://example.com/api/push/subscribe', { method: 'POST', headers: { authorization: 'Bearer token' }, body: JSON.stringify(body) })), writes, filters };
}
const body = (url = endpoint) => ({ mode: 'refresh', subscription: { endpoint: url, keys } });

test('unchanged active push subscription needs no write', async () => {
  const route = api();
  assert.equal((await route.post(body())).status, 200);
  assert.equal(route.writes.length, 0);
});
test('passive renewal never steals another device or revives disabled devices', async () => {
  for (const active of [null, { id: 'other', endpoint: 'https://web.push.apple.com/other' }]) {
    const route = api({ active });
    assert.equal((await route.post(body())).status, 409);
    assert.equal(route.writes.length, 0);
  }
});
test('rotated endpoint updates only the authenticated active row with compare-and-swap guards', async () => {
  const route = api();
  assert.equal((await route.post({ ...body('https://web.push.apple.com/rotated'), previousEndpoint: endpoint })).status, 200);
  assert.ok(route.filters.some(([key, value]) => key === 'user_id' && value === 'member'));
  assert.ok(route.filters.some(([key, value]) => key === 'disabled_at' && value === null));
  assert.ok(route.filters.some(([key, value]) => key === 'endpoint' && value === endpoint));
});
test('concurrent device replacement prevents passive renewal', async () => {
  const route = api({ changed: true });
  assert.equal((await route.post({ ...body('https://web.push.apple.com/rotated'), previousEndpoint: endpoint })).status, 409);
});
test('unauthorized and unapproved accounts cannot renew subscriptions', async () => {
  for (const [options, status] of [[{ valid: false }, 401], [{ approved: false }, 403]]) {
    const route = api(options);
    assert.equal((await route.post(body())).status, status);
    assert.equal(route.writes.length, 0);
  }
});
test('explicit registration still uses the single-device RPC', async () => {
  const route = api({ active: null });
  assert.equal((await route.post({ ...body(), mode: 'register' })).status, 200);
  assert.equal(route.writes[0].p_endpoint, endpoint);
});

test('client waits for an active worker and preserves a working subscription when server is offline', async () => {
  const exports = {}, calls = [], storage = new Map();
  let ready;
  const registration = { pushManager: {
    getSubscription: async () => { calls.push('get-subscription'); return { endpoint, options: {}, toJSON: () => ({ endpoint, keys }) }; },
  } };
  const compiled = ts.transpileModule(fs.readFileSync('app/push-client.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { exports, navigator: { serviceWorker: { register: async () => registration, ready: new Promise(resolve => { ready = resolve; }) } },
    window: { PushManager: {}, Notification: {} }, Notification: { permission: 'granted' }, setTimeout, clearTimeout, Uint8Array, atob,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    fetch: async (url) => { calls.push(url); if (url.includes('public-key')) return json({ publicKey: 'AQID' }); return json({ error: 'offline' }, { status: 503 }); },
  });
  const pending = exports.syncPushSubscription('member', 'token');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 0, 'subscription access waits for worker activation');
  ready(registration);
  await assert.rejects(pending, /offline/);
  assert.equal(storage.size, 0, 'failed renewal does not overwrite device identity');
});

test('explicit repair replaces a stale browser subscription even when its VAPID key is unchanged', async () => {
  const exports = {}, calls = [];
  const replacement = { endpoint: 'https://web.push.apple.com/new-device', toJSON: () => ({ endpoint: 'https://web.push.apple.com/new-device', keys }) };
  let current = { endpoint, options: {}, unsubscribe: async () => { calls.push('unsubscribe'); current = null; return true; } };
  const registration = { pushManager: { getSubscription: async () => current, subscribe: async () => { calls.push('subscribe'); return replacement; } } };
  const compiled = ts.transpileModule(fs.readFileSync('app/push-client.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(compiled, { exports, navigator: { serviceWorker: { register: async () => registration, ready: Promise.resolve(registration) } },
    window: { PushManager: {}, Notification: {} }, Notification: { permission: 'granted' }, setTimeout, clearTimeout, Uint8Array, atob,
    localStorage: { getItem: () => endpoint, setItem: (_key, value) => calls.push(value) },
    fetch: async (url, init) => { if (url.includes('public-key')) return json({ publicKey: 'AQID' }); calls.push(JSON.parse(init.body).mode); return json({ ok: true }); },
  });
  assert.equal((await exports.syncPushSubscription('member', 'token', true, true)).ok, true);
  assert.deepEqual(calls, ['unsubscribe', 'subscribe', 'register', replacement.endpoint]);
});
