import test from 'node:test';
import assert from 'node:assert/strict';
import { readBoundedJson } from '../app/api/bounded-json.ts';
import { isAllowedWebPushEndpoint, isValidWebPushSubscription } from '../app/push-utils.ts';

function request(chunks, headers = {}) {
  const encoder = new TextEncoder();
  return new Request('https://example.com/api', {
    method: 'POST',
    headers,
    duplex: 'half',
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  });
}

test('accepts a JSON object at the exact byte limit across chunks', async () => {
  assert.deepEqual(await readBoundedJson(request(['{"ok":', 'true}']), 11), {
    ok: true, value: { ok: true },
  });
});

test('rejects oversized streams with absent or falsified length', async () => {
  for (const headers of [{}, { 'content-length': '1' }]) {
    assert.deepEqual(await readBoundedJson(request(['{"a":"', 'x'.repeat(100), '"}'], headers), 16), {
      ok: false, status: 413,
    });
  }
});

test('counts UTF-8 bytes rather than characters', async () => {
  const json = JSON.stringify({ name: '\uD55C\uAE00' });
  assert.deepEqual(await readBoundedJson(request([json]), json.length), { ok: false, status: 413 });
  assert.equal((await readBoundedJson(request([json]), Buffer.byteLength(json))).ok, true);
});

test('rejects malformed JSON and non-object JSON', async () => {
  for (const json of ['', '{', 'null', '[]', 'true', '"text"', '42']) {
    assert.deepEqual(await readBoundedJson(request([json]), 100), { ok: false, status: 400 });
  }
});

test('cancels the body when the byte limit is exceeded', async () => {
  let cancelled = false;
  const req = new Request('https://example.com', {
    method: 'POST', duplex: 'half',
    body: new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(32)); },
      cancel() { cancelled = true; },
    }),
  });
  assert.equal((await readBoundedJson(req, 16)).status, 413);
  assert.equal(cancelled, true);
});

test('untrusted subscription field types return false without throwing', () => {
  const valid = { endpoint: 'https://fcm.googleapis.com/push/example', p256dh: 'A'.repeat(87), auth_key: 'A'.repeat(22) };
  assert.equal(isValidWebPushSubscription(valid), true);
  for (const field of ['endpoint', 'p256dh', 'auth_key']) {
    for (const value of [null, undefined, 5, {}, []]) {
      assert.equal(isValidWebPushSubscription({ ...valid, [field]: value }), false);
    }
  }
});

test('rejects push endpoints outside the provider allowlist', () => {
  for (const endpoint of [
    'http://fcm.googleapis.com/push/a', 'https://127.0.0.1/private',
    'https://fcm.googleapis.com.evil.example/push/a',
    'https://user:password@fcm.googleapis.com/push/a',
    'https://fcm.googleapis.com:8443/push/a',
  ]) assert.equal(isAllowedWebPushEndpoint(endpoint), false);
});
