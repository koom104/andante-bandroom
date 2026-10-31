import test from 'node:test';
import assert from 'node:assert/strict';
import { blurRecapPixels } from '../app/recap-blur.ts';

test('software blur preserves a uniform image', () => {
  const pixels = new Uint8ClampedArray(Array.from({ length: 24 }, () => [50, 100, 150, 255]).flat());
  const original = pixels.slice();
  blurRecapPixels(pixels, 6, 4, 2);
  assert.deepEqual(pixels, original);
});

test('software blur spreads light smoothly without dark transparent fringes', () => {
  const pixels = new Uint8ClampedArray(9 * 9 * 4);
  pixels.set([255, 100, 50, 255], (4 * 9 + 4) * 4);
  blurRecapPixels(pixels, 9, 9, 1);
  const center = (4 * 9 + 4) * 4;
  const neighbor = (4 * 9 + 5) * 4;
  assert.ok(pixels[center + 3] > 0 && pixels[center + 3] < 255);
  assert.ok(pixels[neighbor + 3] > 0);
  assert.deepEqual(Array.from(pixels.slice(neighbor, neighbor + 3)), [255, 100, 50]);
});
