// Managed team projects — plan T21/T22. A designer who signed in to their team's own server (on the
// hub's page — issue #204: the app takes no email or password) opens its project and gets back
// everything the native shell needs to create the project's copy: no folder, no token, no Git.
//
// Runs against a REAL hub (the Node fixture — Bun cannot load better-sqlite3).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type { Context } from '../context.ts';
import { groupsFromBootstrap, prepareManagedProject } from '../managed-projects.ts';
import { storeFixtureHubCredential } from './_hub-password-login.ts';

const HUB_DIR = resolve(import.meta.dir, '../../hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
const PASSWORD = 'designer-pass-1';

describe('groupsFromBootstrap', () => {
  test('declared groups win, then the folders the manifest uses', () => {
    expect(
      groupsFromBootstrap({
        canvasGroups: ['ui', { path: 'Návrhy' }, '../x', '_state'],
        docs: [
          { path: 'screens/home.tsx' },
          { path: 'ui/button.tsx' },
          { path: 'root.tsx' },
          { path: 'gone/old.tsx', retired: true },
          { path: null },
        ],
        dirs: ['empty/nested'],
      })
    ).toEqual(['ui', 'Návrhy', 'screens', 'empty']);
  });

  test('an empty project still gets somewhere to put a canvas', () => {
    expect(groupsFromBootstrap({})).toEqual(['system', 'ui']);
  });
});

interface Hub {
  proc: ChildProcess;
  http: string;
}

function startHub(dataDir: string): Promise<Hub> {
  return new Promise((ok, fail) => {
    const proc = spawn('node', [FIXTURE, dataDir, '0', '--transactions', '--users'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let buf = '';
    const timer = setTimeout(() => fail(new Error(`hub did not start: ${buf}`)), 20_000);
    proc.stdout?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
      const line = buf.split('\n').find((l) => l.startsWith('{'));
      if (!line) return;
      clearTimeout(timer);
      ok({ proc, http: JSON.parse(line).http });
    });
    proc.stderr?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
    });
  });
}

describe.skipIf(!HUB_READY)('prepareManagedProject — a team server sign-in', () => {
  let hub: Hub;
  let dir: string;
  const prevCfg = process.env.HUBS_CONFIG_PATH;
  const ctx = {} as Context;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'maude-managed-'));
    process.env.HUBS_CONFIG_PATH = join(dir, 'hubs.json');
    hub = await startHub(join(dir, 'hub'));
  });

  afterAll(async () => {
    await new Promise<void>((r) => {
      if (hub.proc.exitCode !== null) return r();
      hub.proc.once('exit', () => r());
      hub.proc.kill('SIGTERM');
    });
    if (prevCfg === undefined) delete process.env.HUBS_CONFIG_PATH;
    else process.env.HUBS_CONFIG_PATH = prevCfg;
    rmSync(dir, { recursive: true, force: true });
  });

  test('a server this computer holds a credential for → the project described, the password not kept', async () => {
    // the credential a browser sign-in would have stored (fixture login, test-only)
    await storeFixtureHubCredential(hub.http, 'designer@x.test', PASSWORD);
    const r = await prepareManagedProject(ctx, { kind: 'known-hub', url: hub.http });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.serverUrl).toBe(hub.http.replace(/\/$/, ''));
    expect(r.projectId).toBe('local');
    expect(r.mode).toBe('transactions');
    expect(r.canvasGroups).toEqual(['system', 'ui']);
    // The shell keys the copy by (server, id); the name is what the person reads.
    expect(r.name).toBe(new URL(hub.http).host);

    const stored = readFileSync(process.env.HUBS_CONFIG_PATH as string, 'utf8');
    expect(stored).toContain(r.serverUrl);
    expect(stored).not.toContain(PASSWORD);
  });

  test('an open never restarts the running sync (only a new credential does)', async () => {
    const restarts: unknown[] = [];
    const syncing = {
      cfg: { linkedHub: { url: `${hub.http.replace(/\/$/, '')}/` } },
      syncControl: {
        restart: async (...args: unknown[]) => {
          restarts.push(args);
          return { syncing: true, canvases: 1 };
        },
      },
    } as unknown as Context;
    await prepareManagedProject(syncing, { kind: 'known-hub', url: hub.http });
    expect(restarts).toHaveLength(0);
  });

  test('an unknown server without a sign-in is refused, not guessed', async () => {
    const r = await prepareManagedProject(ctx, { kind: 'known-hub', url: 'http://127.0.0.1:9' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(401);
  });
});
