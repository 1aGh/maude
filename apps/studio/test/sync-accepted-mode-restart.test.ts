// F3/S06 on a real self-host hub: a desktop that restarts while OFFLINE forgot
// that its project saves through accepted revisions. With the mode 'unknown',
// its offline edits took the legacy shared-document path, the hub fenced those
// raw updates (as it must — S05), and the work never reached the project while
// the status read "synced". The last verdict the hub gave is now remembered.

import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAcceptedLink } from '../sync/accepted-link.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const bootstrapBody = (mode: 'transactions' | 'legacy') => ({
  protocol: 1,
  projectId: 'p-restart',
  schema: 1,
  mode,
  epoch: 1,
  revision: 3,
  docs: [],
  dirs: [],
});
const answering = (mode: 'transactions' | 'legacy') =>
  (async () =>
    new Response(JSON.stringify(bootstrapBody(mode)), { status: 200 })) as unknown as typeof fetch;
const offline = (async () => {
  throw new TypeError('fetch failed');
}) as unknown as typeof fetch;
const quiet = { log() {}, warn() {}, error() {} };

function link(designRoot: string, fetchImpl: typeof fetch, hubUrl = 'http://hub.test') {
  return createAcceptedLink({
    hubUrl,
    token: () => 't',
    designRoot,
    docNameFor: (slug) => slug,
    fetchImpl,
    log: quiet,
    retryMs: 60_000,
  });
}

test('a restart without the network keeps the accepted-revisions verdict', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maude-mode-restart-'));
  dirs.push(root);
  const first = link(root, answering('transactions'));
  await first.refresh();
  expect(first.mode).toBe('transactions');
  first.stop?.();

  const restarted = link(root, offline);
  await restarted.refresh();
  expect(restarted.mode).toBe('transactions');
  expect(restarted.laneLink('ui-a').on()).toBe(true);
  restarted.stop?.();
});

test('the hub still has the last word, and another hub starts unknown', async () => {
  const root = mkdtempSync(join(tmpdir(), 'maude-mode-restart-'));
  dirs.push(root);
  const first = link(root, answering('transactions'));
  await first.refresh();
  first.stop?.();

  const switched = link(root, answering('legacy'));
  await switched.refresh();
  expect(switched.mode).toBe('legacy');
  switched.stop?.();
  const afterSwitch = link(root, offline);
  await afterSwitch.refresh();
  expect(afterSwitch.mode).toBe('legacy');
  afterSwitch.stop?.();

  const other = link(root, offline, 'http://another-hub.test');
  await other.refresh();
  expect(other.mode).toBe('unknown');
  other.stop?.();
});
