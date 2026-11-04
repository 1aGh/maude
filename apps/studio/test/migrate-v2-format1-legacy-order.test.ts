// #166 (2.0.4) coverage — the format-1 + legacy Update, call by call. migrate-v2-save-mode.test.ts
// pins the two changes and the flip → writes → switch order on the WRITES; this file pins every hub
// call of one Update (dry run, then apply) in order, and the cases where a step in the middle fails:
//
//   dry run:  health → mode → setMode:dry            (nothing written, locally or on the hub)
//   apply:    health → mode → setMode:dry → setFormat(2) → [local writes] → mode → setMode(epoch read again)
//
// A pre-1.9.0 hub (no `format-v2`) refuses before ANY authenticated call — its real-hub leg is
// scripts/v2-verify/docker-selfhost.mjs `old.v2-on-v181-hub`.

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { applyMigration, EXIT, planMigration } from '../migrate/engine.ts';
import { fakeHub, fixtureProject, opts, type Project } from './_migrate-harness.ts';

let p: Project | null = null;
afterEach(() => {
  p?.dispose();
  p = null;
});

const HUB = 'https://hub.example';
const owner = { url: HUB, token: 't', role: 'owner' };

function legacyFormat1(init: Parameters<typeof fakeHub>[0] = { formatVersion: 1 }) {
  p = fixtureProject();
  const f = path.join(p.design, 'config.json');
  const cfg = JSON.parse(readFileSync(f, 'utf8'));
  writeFileSync(
    f,
    `${JSON.stringify({ ...cfg, linkedHub: { url: HUB, linkedAt: 1 } }, null, 2)}\n`
  );
  return fakeHub({ mode: 'legacy', ...init });
}
const localFormat = () =>
  JSON.parse(readFileSync(path.join((p as Project).design, 'config.json'), 'utf8')).formatVersion ??
  1;

describe('format 1 + legacy — every hub call of one Update, in order', () => {
  test('the dry run reads only: health → mode → the blockers-only preview', async () => {
    const hub = legacyFormat1();
    const dry = await planMigration(opts(p as Project, { hub: owner, hubClient: hub.client }));
    expect(dry.exitCode).toBe(EXIT.done);
    expect(hub.calls.map((c) => c.op)).toEqual(['health', 'mode', 'setMode:dry']);
    expect(hub.calls[2].expectEpoch).toBe(4); // asked on the epoch the mode read gave
    expect(hub.state).toMatchObject({ formatVersion: 1, mode: 'legacy', epoch: 4 });
    expect(localFormat()).toBe(1);
  });

  test('the apply: flip → local writes → mode read again → switch on the new epoch', async () => {
    const hub = legacyFormat1();
    const o = opts(p as Project, { hub: owner, hubClient: hub.client });
    const dry = await planMigration(o);
    hub.calls.length = 0;
    const formatAtCall: Record<string, number> = {};
    hub.state.onSet = () => {
      formatAtCall.setFormat = localFormat();
    };
    hub.state.onSetMode = () => {
      formatAtCall.setMode = localFormat();
    };
    const r = await applyMigration(o, dry);
    expect(r.exitCode).toBe(EXIT.done);
    const ops = hub.calls.map((c) => c.op);
    const at = (op: string, from = 0) => ops.indexOf(op as (typeof ops)[number], from);
    const flip = at('setFormat');
    const reread = at('mode', flip + 1);
    const sw = at('setMode');
    expect(flip).toBeGreaterThan(-1);
    expect(reread).toBeGreaterThan(flip); // the epoch is read AGAIN after the flip
    expect(sw).toBeGreaterThan(reread);
    expect(ops.filter((o) => o === 'setFormat')).toHaveLength(1);
    expect(ops.filter((o) => o === 'setMode')).toHaveLength(1);
    expect(hub.calls[flip].formatVersion).toBe(2);
    expect(hub.calls[sw].expectEpoch).toBe(5); // 4 → 5 by the flip; never the plan-time 4
    // the hub moved first, the folder before the switch
    expect(formatAtCall).toEqual({ setFormat: 1, setMode: 2 });
    expect(hub.state).toMatchObject({ formatVersion: 2, mode: 'transactions', epoch: 6 });
    expect(r.project.linked).toMatchObject({ modeSwitched: true });
  });

  test('the hub refuses the flip: nothing local changes and the mode is never asked to move', async () => {
    const hub = legacyFormat1();
    const o = opts(p as Project, { hub: owner, hubClient: hub.client });
    const dry = await planMigration(o);
    hub.state.refuse = { status: 409, code: 'epoch-stale' };
    // a refusal report or a throw — either way the folder and the mode stay as they were
    const r = await applyMigration(o, dry).catch(() => null);
    if (r) expect(r.exitCode).not.toBe(EXIT.done);
    expect(hub.calls.some((c) => c.op === 'setFormat')).toBe(true);
    expect(localFormat()).toBe(1);
    expect(hub.calls.some((c) => c.op === 'setMode')).toBe(false);
    expect(hub.state.mode).toBe('legacy');
  });

  test('another owner switched the mode between the dry run and the apply: no second switch', async () => {
    const hub = legacyFormat1();
    const o = opts(p as Project, { hub: owner, hubClient: hub.client });
    const dry = await planMigration(o);
    hub.state.mode = 'transactions'; // someone else's Update landed first
    hub.state.epoch += 1;
    const r = await applyMigration(o, dry);
    expect(r.exitCode).toBe(EXIT.done);
    expect(localFormat()).toBe(2);
    expect(hub.calls.some((c) => c.op === 'setMode')).toBe(false);
    // the apply re-plans and reads the hub's own mode: nothing left to switch, nothing claimed
    expect(r.project.linked).toMatchObject({ mode: 'transactions', modeSwitched: false });
    expect(hub.state.mode).toBe('transactions');
  });

  test('a hub `admin` is the owner there: the same order, both changes', async () => {
    const hub = legacyFormat1();
    const o = opts(p as Project, { hub: { ...owner, role: 'admin' }, hubClient: hub.client });
    const dry = await planMigration(o);
    expect(dry.exitCode).toBe(EXIT.done);
    const r = await applyMigration(o, dry);
    expect(r.exitCode).toBe(EXIT.done);
    expect(hub.state).toMatchObject({ formatVersion: 2, mode: 'transactions' });
  });

  test('a pre-1.9.0 hub (no format-v2) refuses after /health alone — no credentialed call', async () => {
    const hub = legacyFormat1({ formatVersion: null, capabilities: ['ledger', 'annotations-v2'] });
    const dry = await planMigration(opts(p as Project, { hub: owner, hubClient: hub.client }));
    expect(dry.exitCode).not.toBe(EXIT.done);
    expect(dry.refusals.map((r) => r.code)).toContain('hub-too-old');
    expect(hub.calls.map((c) => c.op)).toEqual(['health']);
    expect(localFormat()).toBe(1);
  });
});
