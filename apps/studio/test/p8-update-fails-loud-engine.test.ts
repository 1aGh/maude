// p8-update-fails-loud — the engine half. "Update project did nothing" on a hub-linked project whose
// hub token had expired (the alligators report, 2026-10-29). The engine must (1) refuse BEFORE touching
// anything when the hub turns this Mac's credential down, with a code the app can turn into "Sign in
// again"; (2) never leave a project half-converted: the format goes first, the save-mode switch last
// (decision `maude/v2-p8-update-to-accepted-failure-is-a-note`), so a switch the hub refuses after the
// format moved leaves the consistent "format 2, saves the old way" state — every canvas file whole.

import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { EXIT, MIGRATE_LOCK_REL, planMigration } from '../migrate/engine.ts';
import {
  fakeHub,
  fixtureProject,
  fullTreeHash,
  listTree,
  opts,
  type Project,
  run,
} from './_migrate-harness.ts';

let p: Project | null = null;
afterEach(() => {
  p?.dispose();
  p = null;
});

const HUB = 'https://hub.example';
const owner = { url: HUB, token: 'expired', role: 'owner' };
const REJECTED = { status: 401, code: 'invalid-token' };

function link(project: Project) {
  const f = path.join(project.design, 'config.json');
  const cfg = JSON.parse(readFileSync(f, 'utf8'));
  writeFileSync(
    f,
    `${JSON.stringify({ ...cfg, linkedHub: { url: HUB, linkedAt: 1 } }, null, 2)}\n`
  );
}
const localFormat = (project: Project) =>
  JSON.parse(readFileSync(path.join(project.design, 'config.json'), 'utf8')).formatVersion ?? 1;
const sha = (abs: string) =>
  `sha256:${createHash('sha256').update(readFileSync(abs)).digest('hex')}`;

function format1() {
  p = fixtureProject();
  link(p);
  return fakeHub({ formatVersion: 1, mode: 'legacy' });
}
async function format2() {
  p = fixtureProject();
  await run(opts(p));
  link(p);
  return fakeHub({ formatVersion: 2, mode: 'legacy' });
}

describe('Update project — the hub turns this Mac’s sign-in down', () => {
  test('format 1: the dry run refuses with token-rejected, and Update writes nothing', async () => {
    const hub = format1();
    hub.state.refuseModeRead = REJECTED;
    const before = fullTreeHash((p as Project).design);
    const o = opts(p as Project, { hub: owner, hubClient: hub.client });
    const dry = await planMigration(o);
    expect(dry.exitCode).toBe(EXIT.refused);
    expect(dry.refusals.map((r) => r.code)).toContain('token-rejected');
    const r = await run(o);
    expect(r.exitCode).toBe(EXIT.refused);
    expect(fullTreeHash((p as Project).design)).toBe(before);
    expect(hub.calls.some((c) => c.op === 'setFormat' || c.op === 'setMode')).toBe(false);
    expect(hub.state.formatVersion).toBe(1);
  });

  test('format 2 + saves the old way: refused with token-rejected; still format 2, still the old way', async () => {
    const hub = await format2();
    hub.state.refuseModeRead = REJECTED;
    const before = fullTreeHash((p as Project).design);
    const r = await run(opts(p as Project, { hub: owner, hubClient: hub.client }));
    expect(r.exitCode).toBe(EXIT.refused);
    expect(r.refusals.map((x) => x.code)).toContain('token-rejected');
    expect(localFormat(p as Project)).toBe(2);
    expect(hub.state.mode).toBe('legacy');
    expect(fullTreeHash((p as Project).design)).toBe(before);
  });

  test('the format flip itself answers 401 (the token ran out after the dry run): token-rejected, nothing written', async () => {
    const hub = format1();
    const before = fullTreeHash((p as Project).design);
    const o = opts(p as Project, { hub: owner, hubClient: hub.client });
    const dry = await planMigration(o);
    expect(dry.exitCode).toBe(EXIT.done);
    hub.state.refuse = REJECTED;
    const { applyMigration } = await import('../migrate/engine.ts');
    const r = await applyMigration(o, dry);
    expect(r.exitCode).toBe(EXIT.refused);
    expect(r.refusals.map((x) => x.code)).toContain('token-rejected');
    expect(r.snapshot).toBe(null);
    expect(fullTreeHash((p as Project).design)).toBe(before);
    expect(localFormat(p as Project)).toBe(1);
  });

  test('the format flip cannot reach the hub: refused with offline, nothing written', async () => {
    const hub = format1();
    const before = fullTreeHash((p as Project).design);
    const o = opts(p as Project, { hub: owner, hubClient: hub.client });
    const dry = await planMigration(o);
    hub.state.refuse = { status: 0, code: 'unreachable' };
    const { applyMigration } = await import('../migrate/engine.ts');
    const r = await applyMigration(o, dry);
    expect(r.refusals.map((x) => x.code)).toContain('offline');
    expect(fullTreeHash((p as Project).design)).toBe(before);
  });
});

describe('Update project — never half-converted', () => {
  test('format moves, then the switch answers 401: format 2 that saves the old way, every file whole', async () => {
    const hub = format1();
    hub.state.refuseMode = REJECTED;
    const o = opts(p as Project, { hub: owner, hubClient: hub.client });
    const r = await run(o);
    // the consistent state the engine is built to leave (failure-is-a-note): exit 0, format 2, legacy
    expect(r.exitCode).toBe(EXIT.done);
    expect(localFormat(p as Project)).toBe(2);
    expect(hub.state.formatVersion).toBe(2);
    expect(hub.state.mode).toBe('legacy');
    expect(r.project.linked).toMatchObject({
      modeDue: true,
      modeSwitched: false,
      modeError: 'token-rejected',
    });
    // no canvas file half-written: no staged temp file, no lock, and every file the run wrote holds
    // exactly the bytes the report says it wrote
    const design = (p as Project).design;
    expect(listTree(design).filter((f) => f.endsWith('.migrate-v2.tmp'))).toEqual([]);
    expect(existsSync(path.join(design, MIGRATE_LOCK_REL))).toBe(false);
    const written = r.steps.flatMap((s) => s.files).filter((f) => f.action !== 'remove');
    expect(written.length).toBeGreaterThan(0);
    for (const f of written) expect(sha(path.join(design, ...f.path.split('/')))).toBe(f.after);
    // and the next look says why, with the format already at 2
    hub.state.refuseModeRead = REJECTED;
    const next = await planMigration(o);
    expect(next.project.formatBefore).toBe(2);
    expect(next.refusals.map((x) => x.code)).toContain('token-rejected');
  });
});
