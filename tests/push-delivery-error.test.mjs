import test from 'node:test';
import assert from 'node:assert/strict';
import { pushDeliveryError } from '../app/push-delivery-error.ts';

test('expired Apple subscriptions are distinguished from authentication and network failures', () => {
  for (const status of [404, 410]) assert.equal(pushDeliveryError(status).code, 'PUSH_SUBSCRIPTION_EXPIRED');
  for (const status of [401, 403]) assert.equal(pushDeliveryError(status).code, 'PUSH_AUTH_REJECTED');
  assert.equal(pushDeliveryError(429).code, 'PUSH_RATE_LIMITED');
  assert.equal(pushDeliveryError(400).code, 'PUSH_PAYLOAD_REJECTED');
  assert.equal(pushDeliveryError(null).code, 'PUSH_REQUEST_FAILED');
  assert.equal(pushDeliveryError(503).code, 'PUSH_PROVIDER_UNAVAILABLE');
  assert.equal(pushDeliveryError(400, 'VapidPkHashMismatch').code, 'PUSH_KEY_MISMATCH');
});
