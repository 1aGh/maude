// rc3-j (#162) — the desktop cloud lane's cell answers Share the way a fleet cell does.
//
// A cloud-identity cell decides nothing about access: every `/api/access/*` is forwarded to its control plane
// (routes-v2/access.mjs `forward`). The lane's cell (apps/desktop/e2e/fixtures/local-hub.mjs
// `startCloudLaneCell`) had no control plane, so its Share sheet showed the cell's own 503 "Sharing is not
// available right now" under "Moved to Maude Cloud" — a screenshot that read as a product bug. With
// `access`, the cell forwards to the REAL control-plane forwarder (apps/cloud/access-forward.mjs) over a
// throwaway D1. Everything is loopback; no control plane, cell or account outside this machine.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { mintProjectToken, startCloudLaneCell } from '../../desktop/e2e/fixtures/local-hub.mjs';

const OWNER = 'e2e@example.com';
const PROJECT = 'stub-project';
const dirs = [];
const cells = [];
after(() => {
  for (const c of cells) c.stop();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function laneCell({ access }) {
  const dir = mkdtempSync(join(tmpdir(), 'rc3j-lane-cell-'));
  dirs.push(dir);
  const cloudKey = `rc3j-${Math.random().toString(36).slice(2)}`;
  const cell = await startCloudLaneCell({
    dir,
    cloudKey,
    projectConfig: { name: 'lane', formatVersion: 2, designRoot: '.design' },
    ...(access ? { access: { project: PROJECT, owner: OWNER } } : {}),
  });
  cells.push(cell);
  const projectToken = await mintProjectToken(cloudKey, {
    email: OWNER,
    role: 'owner',
    project: PROJECT,
  });
  const login = await fetch(`${cell.http}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: projectToken }),
  });
  assert.equal(login.status, 200, 'the cell takes the project token');
  const { token } = await login.json();
  const ask = async (path) => {
    const r = await fetch(`${cell.http}${path}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { cell, ask };
}

describe('the cloud lane cell and Share', () => {
  test('with its control plane: me and people answer at once, the owner is in the list', async () => {
    const { cell, ask } = await laneCell({ access: true });
    const me = await ask('/api/access/me');
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.equal(me.body.role, 'owner');
    const people = await ask('/api/access/people');
    assert.equal(people.status, 200, JSON.stringify(people.body));
    assert.ok(
      people.body.people.some((p) => p.email === OWNER),
      `the owner is listed: ${JSON.stringify(people.body)}`
    );
    assert.match(cell.authority?.http ?? '', /^http:\/\/127\.0\.0\.1:\d+$/, 'loopback only');
  });

  test('without one, the cell says so itself — the words the misleading lane shot carried', async () => {
    const { ask } = await laneCell({ access: false });
    const people = await ask('/api/access/people');
    assert.equal(people.status, 503);
    assert.equal(people.body.error, 'Sharing is not available right now. Try again in a minute.');
  });
});
