// #166 (2.0.4) — a duplicate attach call signs in at the cell ONCE.
//
// rc3-j (#162) removed the second sign-in inside one Move to cloud (cloud-move-route.test.ts). What was left: two
// attach calls that arrive together — a Connect pressed twice before the first answer, a Move to cloud and a
// Connect racing — each ran its own /projects/open + cell /auth/login, ~5 ms apart, and minted two hub
// sessions for one person. The attach lane is single-flight per project / per cell: a concurrent repeat
// shares the call already running and gets the same answer; a later call (after it settled) runs again.

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createCloudEndpoints } from '../cloud/endpoints.ts';

const events: string[] = [];

const cell = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === '/auth/login') {
      events.push('login');
      await Bun.sleep(20); // a real cell takes a moment — the window a second press lands in
      return Response.json({ token: 'hubtok_secret', user: { role: 'owner' } });
    }
    return new Response('not found', { status: 404 });
  },
});
const CELL = `http://127.0.0.1:${cell.port}`;

const cloud = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname === '/projects/open' && req.method === 'POST') {
      events.push('open');
      return Response.json({ token: 'ptok_secret', url: CELL, role: 'owner' });
    }
    return new Response('not found', { status: 404 });
  },
});
const CLOUD = `http://127.0.0.1:${cloud.port}`;

let tmp = '';
let designRoot = '';
const saved: Record<string, string | undefined> = {};
const ENV = ['MAUDE_CLOUD_URL', 'MAUDE_CLOUD_CONFIG', 'HUBS_CONFIG_PATH', 'MAUDE_MACHINE_FILE'];

beforeEach(() => {
  events.length = 0;
  tmp = mkdtempSync(join(tmpdir(), 'maude-attach-once-'));
  designRoot = join(tmp, 'repo', '.design');
  mkdirSync(designRoot, { recursive: true });
  writeFileSync(join(designRoot, 'config.json'), `${JSON.stringify({ name: 'Alligators' })}\n`);
  for (const k of ENV) saved[k] = process.env[k];
  process.env.MAUDE_CLOUD_URL = CLOUD;
  process.env.MAUDE_CLOUD_CONFIG = join(tmp, 'cloud.json');
  process.env.HUBS_CONFIG_PATH = join(tmp, 'hubs.json');
  process.env.MAUDE_MACHINE_FILE = join(tmp, 'machine.json');
  writeFileSync(
    process.env.MAUDE_CLOUD_CONFIG,
    JSON.stringify({ url: CLOUD, token: 'mpt_test', email: 'a@example.com', connectedAt: 1 })
  );
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(tmp, { recursive: true, force: true });
});

afterAll(() => {
  cell.stop(true);
  cloud.stop(true);
});

function endpoints() {
  let restarts = 0;
  const api = createCloudEndpoints({
    paths: { repoRoot: join(tmp, 'repo'), designRoot },
    syncControl: {
      async restart() {
        restarts++;
        return { syncing: true, canvases: 0 };
      },
    },
  });
  return { api, restarts: () => restarts };
}

const count = (e: string) => events.filter((x) => x === e).length;

describe('the attach lane is single-flight (#166)', () => {
  test('two Connects pressed together open the project and sign in at the cell once', async () => {
    const { api, restarts } = endpoints();
    const [a, b] = await Promise.all([api.attach('alligators'), api.attach('alligators')]);
    expect(a.status).toBe(200);
    expect(b).toEqual(a);
    expect(count('open')).toBe(1);
    expect(count('login')).toBe(1);
    expect(restarts()).toBe(1);
  });

  test('two managed opens of one project sign in once', async () => {
    const { api } = endpoints();
    const [a, b] = await Promise.all([
      api.openManaged('alligators'),
      api.openManaged('alligators'),
    ]);
    expect(a.status).toBe(200);
    expect(b).toEqual(a);
    expect(count('login')).toBe(1);
  });

  test('a link with the stored credential while it is being linked cycles the runtime once', async () => {
    const { api, restarts } = endpoints();
    expect((await api.openManaged('alligators')).status).toBe(200);
    const [a, b] = await Promise.all([api.attachStored(CELL), api.attachStored(CELL)]);
    expect(a.status).toBe(200);
    expect(b).toEqual(a);
    expect(restarts()).toBe(1);
  });

  test('a call after the first settled runs again; another project never waits on this one', async () => {
    const { api } = endpoints();
    await api.attach('alligators');
    await api.attach('alligators');
    expect(count('login')).toBe(2);
    events.length = 0;
    await Promise.all([api.openManaged('alligators'), api.openManaged('crocodiles')]);
    expect(count('open')).toBe(2);
  });
});
