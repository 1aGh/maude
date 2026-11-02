// r1-roleless-signin (Michal rc.1, finding 1, option A) — booted half of r1-roleless-signin.test.ts: a real
// studio on a format-1 project linked (on this Mac) to a hub whose hubs.json record carries a token but
// NO role — a 1.x `maude design link --token`. `/_config` keeps the observer floor (readOnlyReason
// 'role') and says where it came from (`roleSource: 'missing'`), so the callout offers Sign in. A
// record whose role the hub vouched (observer) says 'stored' — Ask the owner. Every credential path is a
// throwaway fixture (HUBS_CONFIG_PATH / MAUDE_CLOUD_CONFIG / XDG_CONFIG_HOME in the sandbox).

import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Subprocess } from 'bun';

import { bootServer, killProc, makeSandbox, nextPort, type Sandbox } from './_helpers.ts';

let box: Sandbox | null = null;
let proc: Subprocess | null = null;
afterEach(async () => {
  if (proc) await killProc(proc);
  if (box) rmSync(box.root, { recursive: true, force: true });
  proc = null;
  box = null;
});

/** A format-1 project linked to a hub nothing listens on, with `record` as this Mac's hubs.json entry. */
async function config(record: Record<string, unknown> | null) {
  box = makeSandbox();
  const hubUrl = `http://localhost:${nextPort()}`;
  const cfgPath = path.join(box.designRoot, 'config.json');
  const { formatVersion: _drop, ...cfg } = JSON.parse(readFileSync(cfgPath, 'utf8'));
  writeFileSync(cfgPath, JSON.stringify({ ...cfg, linkedHub: { url: hubUrl, linkedAt: 1 } }));
  const cfgDir = path.join(box.root, 'cfg');
  mkdirSync(cfgDir, { recursive: true });
  const hubs = path.join(cfgDir, 'hubs.json');
  writeFileSync(hubs, JSON.stringify({ hubs: record ? { [hubUrl]: record } : {} }), {
    mode: 0o600,
  });
  const port = nextPort();
  proc = await bootServer(box.root, port, {
    MAUDE_NO_AUTOBUILD: '1',
    HUBS_CONFIG_PATH: hubs,
    MAUDE_PROJECT_LINKS_PATH: path.join(cfgDir, 'project-links.json'),
    MAUDE_CLOUD_CONFIG: path.join(cfgDir, 'cloud.json'),
    XDG_CONFIG_HOME: cfgDir,
    MAUDE_INDEX_DIR: path.join(cfgDir, 'index'),
  });
  const res = await fetch(`http://localhost:${port}/_config`);
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

test('a record without a role: the observer floor, and roleSource missing', async () => {
  const cfg = await config({ token: 'tok-test', linkedAt: 1 });
  expect(cfg.readOnly).toBe(true);
  expect(cfg.readOnlyReason).toBe('role');
  expect(cfg.roleSource).toBe('missing');
}, 60_000);

test('a vouched observer role: roleSource stored (Ask the owner)', async () => {
  const cfg = await config({ token: 'tok-test', linkedAt: 1, role: 'observer' });
  expect(cfg.readOnlyReason).toBe('role');
  expect(cfg.roleSource).toBe('stored');
}, 60_000);

test('an owner record: not read-only by role, no roleSource', async () => {
  const cfg = await config({ token: 'tok-test', linkedAt: 1, role: 'owner' });
  expect(cfg.readOnlyReason).toBe('format');
  expect(cfg.roleSource).toBe(null);
}, 60_000);
