// A6c — S11.13's two prefs that change how the AI chat starts (Settings › Advanced):
//   ownPluginCopy      ≡ MAUDE_NO_PLUGIN_BOOTSTRAP=1 (the chat loads your own plugin copy)
//   experimentalTeams  → CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 on the adapter spawn
// `/_api/ui-prefs` is a per-user SESSION write (a viewer keeps their theme), so the route itself
// stays open — but these two keys are this Mac's AI runtime, not a preference: a session that
// cannot edit the project (Can view, Can comment, canvas-only) or a cloud cell (no one's Mac)
// is refused them. Main origin only: tests/canvas-origin-parity.test.ts PRIVILEGED.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { teamsSpawnEnv } from '../acp/env.ts';
import { isNativePluginContext } from '../acp/plugin-bootstrap.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const HUB_URL = 'http://hub.invalid:9';
const procs: Subprocess[] = [];
afterAll(async () => {
  for (const p of procs) await killProc(p);
});

const claim = (c: unknown) => Buffer.from(JSON.stringify(c)).toString('base64url');

async function post(base: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${base}/_api/ui-prefs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, ...headers },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let error: unknown = null;
  try {
    error = (JSON.parse(text) as { error?: unknown }).error ?? null;
  } catch {
    /* plain text */
  }
  return `${r.status} ${error}`;
}

function prefsEnv(root: string) {
  return { MAUDE_UI_PREFS_PATH: join(root, 'prefs.json') };
}

async function bootLinked(record: Record<string, unknown>) {
  const { root, designRoot } = makeSandbox();
  const cfgPath = join(designRoot, 'config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.linkedHub = { url: HUB_URL, linkedAt: Date.now() };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const hubsPath = join(root, 'hubs.json');
  writeFileSync(
    hubsPath,
    JSON.stringify({ hubs: { [HUB_URL]: { token: 't', linkedAt: Date.now(), ...record } } })
  );
  const port = nextPort();
  procs.push(await bootServer(root, port, { HUBS_CONFIG_PATH: hubsPath, ...prefsEnv(root) }));
  return { base: `http://localhost:${port}`, prefs: join(root, 'prefs.json') };
}

const SPAWN_KEYS = [{ ownPluginCopy: true }, { experimentalTeams: true }];
const REFUSED = '403 read-only';

describe('the spawn prefs at ACP start', () => {
  test('ownPluginCopy is MAUDE_NO_PLUGIN_BOOTSTRAP=1: no bundled plugin is injected', () => {
    const saved = process.env.MAUDE_DEV_SERVER_ROOT;
    process.env.MAUDE_DEV_SERVER_ROOT = '/tmp/maude-native';
    try {
      expect(isNativePluginContext({ ownPluginCopy: false })).toBe(true);
      expect(isNativePluginContext({ ownPluginCopy: true })).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.MAUDE_DEV_SERVER_ROOT;
      else process.env.MAUDE_DEV_SERVER_ROOT = saved;
    }
  });

  test('experimentalTeams sets CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1, and only then', () => {
    expect(teamsSpawnEnv({ PATH: '/bin' }, { experimentalTeams: true })).toEqual({
      PATH: '/bin',
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
    });
    expect(teamsSpawnEnv({ PATH: '/bin' }, { experimentalTeams: false })).toEqual({ PATH: '/bin' });
    expect(teamsSpawnEnv({ PATH: '/bin' }, {})).toEqual({ PATH: '/bin' });
  });
});

describe('who may flip them (POST /_api/ui-prefs)', () => {
  test('the person at this Mac (a local project) may; the file says so', async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    procs.push(await bootServer(root, port, prefsEnv(root)));
    const base = `http://localhost:${port}`;
    for (const body of SPAWN_KEYS) expect(await post(base, body)).toBe('200 null');
    const disk = JSON.parse(readFileSync(join(root, 'prefs.json'), 'utf8'));
    expect(disk).toMatchObject({ ownPluginCopy: true, experimentalTeams: true });
  }, 60000);

  // `theme`: what the same session's plain preference write answers — a role keeps its own
  // place (a session write); a canvas-only session has no project-level session lane at all.
  for (const [kind, record, theme] of [
    ['Can view (hub-linked desktop)', { role: 'observer' }, '200 null'],
    ['Can comment (hub-linked desktop)', { role: 'viewer' }, '200 null'],
    [
      'canvas-only (hub-linked desktop)',
      { role: null, access: { v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] } },
      REFUSED,
    ],
  ] as const) {
    test(`${kind}: refused, nothing written`, async () => {
      const { base, prefs } = await bootLinked(record);
      for (const body of SPAWN_KEYS)
        expect([body, await post(base, body)]).toEqual([body, REFUSED]);
      // A refused spawn key refuses the whole patch — the theme beside it is not half-applied.
      expect(await post(base, { theme: 'dark', experimentalTeams: true })).toBe(REFUSED);
      expect(existsSync(prefs)).toBe(false);
      expect(await post(base, { theme: 'dark' })).toBe(theme);
    }, 60000);
  }

  describe('a cloud cell — every session, the owner too', () => {
    let cell = '';
    let prefs = '';
    beforeAll(async () => {
      const { root } = makeSandbox();
      const port = nextPort();
      procs.push(
        await bootServer(root, port, {
          MAUDE_WORKSPACE_MODE: '1',
          MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
          HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
          MAUDE_PROJECT_NAME: 'Alligators',
          ...prefsEnv(root),
        })
      );
      cell = `http://localhost:${port}`;
      prefs = join(root, 'prefs.json');
    }, 60000);

    for (const [kind, headers] of [
      ['owner', { 'x-maude-access': claim({ v: 1, role: 'owner' }), 'x-maude-readonly': '0' }],
      ['viewer', { 'x-maude-access': claim({ v: 1, role: 'observer' }), 'x-maude-readonly': '1' }],
      [
        'canvas-only',
        {
          'x-maude-access': claim({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] }),
          'x-maude-readonly': '1',
        },
      ],
    ] as const) {
      test(`${kind}: refused`, async () => {
        for (const body of SPAWN_KEYS)
          expect([body, await post(cell, body, headers)]).toEqual([body, REFUSED]);
        const disk = existsSync(prefs) ? JSON.parse(readFileSync(prefs, 'utf8')) : {};
        expect([disk.ownPluginCopy, disk.experimentalTeams]).toEqual([undefined, undefined]);
      });
    }
  });
});
