// The data-plane Worker forwards only the render service's own routes (#128 T3.7 adds status and
// cancel); everything else looks like it never existed.

import { expect, test } from 'bun:test';

import { isRenderServiceRoute } from '../routes.mjs';

test('the render, health, status and cancel routes reach the container', () => {
  expect(isRenderServiceRoute('GET', '/_health')).toBe(true);
  expect(isRenderServiceRoute('POST', '/render')).toBe(true);
  expect(isRenderServiceRoute('GET', '/_render/status')).toBe(true);
  expect(isRenderServiceRoute('POST', '/_render/cancel')).toBe(true);
});

test('anything else is not found', () => {
  expect(isRenderServiceRoute('GET', '/render')).toBe(false);
  expect(isRenderServiceRoute('GET', '/_render/cancel')).toBe(false);
  expect(isRenderServiceRoute('POST', '/_render/status')).toBe(false);
  expect(isRenderServiceRoute('GET', '/_render')).toBe(false);
  expect(isRenderServiceRoute('GET', '/')).toBe(false);
});
