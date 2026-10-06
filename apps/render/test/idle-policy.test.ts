// The render container's sleep rule (feature-cloud-cost-and-cold-start-ux T4).
//
// The library's own rule waits for `inflightRequests === 0`, which a client
// that stops reading a response body never lets happen — the September 2026
// render instance ran 24/7 on ~30 requests a day. These pin the replacement,
// and pin the library seam it overrides so an upgrade cannot silently undo it.

import { expect, test } from 'bun:test';

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { IDLE_AFTER_MS, JOB_MAX_MS, renderIdleExpired } from '../idle-policy.mjs';

const MIN = 60_000;
const now = 1_000 * MIN;

test('idle long enough with nothing open → sleep', () => {
  expect(renderIdleExpired({ now, lastActivityAt: now - IDLE_AFTER_MS, openSince: [] })).toBe(true);
});

test('recent activity → stay up', () => {
  expect(renderIdleExpired({ now, lastActivityAt: now - 2 * MIN, openSince: [] })).toBe(false);
});

test('a render still working inside its deadline → stay up, however long idle', () => {
  expect(
    renderIdleExpired({ now, lastActivityAt: now - 40 * MIN, openSince: [now - 40 * MIN] })
  ).toBe(false);
});

test('a request open past the longest possible job is a leak → sleep', () => {
  expect(
    renderIdleExpired({
      now,
      lastActivityAt: now - JOB_MAX_MS - MIN,
      openSince: [now - JOB_MAX_MS - MIN],
    })
  ).toBe(true);
});

test('the library seam this overrides still exists', () => {
  // worker.mjs overrides `isActivityExpired` and logs `inflightRequests`. If a
  // @cloudflare/containers upgrade renames either, the override silently stops
  // being called and the container stops sleeping again — fail here instead.
  // Read as text: the package imports `cloudflare:workers`, which only the
  // Workers runtime resolves.
  const pkg = createRequire(import.meta.url).resolve('@cloudflare/containers/package.json');
  const src = readFileSync(join(dirname(pkg), 'dist/lib/container.js'), 'utf8');
  expect(src).toContain('isActivityExpired()');
  expect(src).toContain('this.isActivityExpired()');
  expect(src).toContain('this.inflightRequests');
  expect(src).toContain('this.sleepAfterMs');
  expect(src).toContain('async onActivityExpired()');
});
