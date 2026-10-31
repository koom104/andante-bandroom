import test from 'node:test';
import assert from 'node:assert/strict';
import { rejectUnsupportedRequest } from '../worker/request-policy.ts';

const request = (path, method = 'GET', headers = {}) => new Request(`https://example.com${path}`, { method, headers });

test('public pages, RSC navigation and assets remain readable', () => {
  for (const path of ['/', '/assets/page.js', '/sw.js', '/icon-192.png', '/?_rsc=normal']) {
    for (const method of ['GET', 'HEAD']) assert.equal(rejectUnsupportedRequest(request(path, method)), null);
  }
});

test('only the existing mutation APIs can receive POST requests', () => {
  for (const path of ['/api/admin/reset-password', '/api/auth/complete-password-reset', '/api/push/booking-event', '/api/push/subscribe', '/api/push/test']) {
    assert.equal(rejectUnsupportedRequest(request(path, 'POST')), null);
    assert.equal(rejectUnsupportedRequest(request(path, 'DELETE')).status, 405);
  }
  for (const path of ['/', '/index.rsc', '/api/unknown', '/_vinext/image']) {
    const response = rejectUnsupportedRequest(request(path, 'POST'));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
  }
});

test('unused Server Action decoding cannot be reached through API requests', () => {
  for (const header of ['next-action', 'x-rsc-action']) {
    assert.equal(rejectUnsupportedRequest(request('/api/push/test', 'POST', { [header]: 'untrusted-action' })).status, 405);
  }
});

test('PHP and private development paths are not served, including encoded paths', () => {
  for (const path of ['/shell.php', '/upload.PHP/a', '/shell.php8', '/test.phtml', '/x.phar', '/%73hell%2ephp', '/.env', '/.env.local', '/.git/config', '/.vite/manifest.json', '/node_modules/test.js', '/@fs/private', '/@vite/client', '/@id/module', '/__open-in-editor']) {
    assert.equal(rejectUnsupportedRequest(request(path)).status, 404, path);
  }
  assert.equal(rejectUnsupportedRequest(request('/invalid%FF')).status, 400);
});
