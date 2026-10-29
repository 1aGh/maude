// p8-update-to-accepted — Update project also switches a LINKED project that saves the old way
// (legacy shared documents) to accepted revisions (Michal, decision
// `maude/v2-michal-update-project-switches-legacy-to-accepted`): one Update, both changes; a format-2
// project that is still legacy gets the same offer; owner only; `--reverse` keeps accepted revisions.
//
// THE ORDER (decision `maude/v2-p8-update-to-accepted-switch-last`): format flip on the hub → local
// writes (all or nothing) → save-mode switch LAST, with the epoch read again after the flip. A local
// failure therefore never leaves a project switched but not updated, and the switch never runs on a
// stale epoch.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { applyMigration, EXIT, planMigration } from '../migrate/engine.ts';
import { fakeHub, fixtureProject, opts, type Project, run } from './_migrate-harness.ts';

let p: Project | null = null;
afterEach(() => {
  p?.dispose();
  p = null;
});

const HUB = 'https://hub.example';
const owner = { url: HUB, token: 't', role: 'owner' };

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

/** A format-1 project linked to a v2 hub that still saves the old way. */
function legacyFormat1() {
  p = fixtureProject();
  link(p);
  return fakeHub({ formatVersion: 1, mode: 'legacy' });
}

/** A project already at format 2 (locally and on the hub) that still saves the old way. */
async function legacyFormat2() {
  p = fixtureProject();
  await run(opts(p)); // local → 2
  link(p);
  return fakeHub({ formatVersion: 2, mode: 'legacy' });
}

describe('Update project — the save mode', () => {
  test('format 1 + legacy: one Update makes both changes', async () => {
    const hub = legacyFormat1();
    const o = opts(p as Project, { hub: owner, hubClient: hub.client });
    const dry = await planMigration(o);
    expect(dry.exitCode).toBe(EXIT.done);
    expect(dry.project.linked).toMatchObject({ mode: 'legacy', modeDue: true, modeSwitched: false });
    expect(hub.calls.some((c) => c.op === 'setMode:dry')).toBe(true); // blockers surfaced up front
    expect(hub.state.mode).toBe('legacy'); // a dry run switches nothing
    const r = await applyMigration(o, dry);
    expect(r.exitCode).toBe(EXIT.done);
    expect(hub.state.formatVersion).toBe(2);
    expect(hub.state.mode).toBe('transactions');
    expect(r.project.linked).toMatchObject({ mode: 'legacy', modeSwitched: true });
    expect(localFormat(p as Project)).toBe(2);
  });

  test('order: format flip → local writes → switch, on the epoch read AFTER the flip', async () => {
    const hub = legacyFormat1();
    const seenAtSwitch: number[] = [];
    hub.state.onSetMode = () => seenAtSwitch.push(localFormat(p as Project));
    const r = await run(opts(p as Project, { hub: owner, hubClient: hub.client }));
    expect(r.exitCode).toBe(EXIT.done);
    const ops = hub.calls.filter((c) => c.op === 'setFormat' || c.op === 'setMode');
    expect(ops.map((c) => c.op)).toEqual(['setFormat', 'setMode']);
    expect(seenAtSwitch).toEqual([2]); // every local write had landed when the mode moved
    // the flip advanced the epoch 4 → 5; the switch asked for 5, not the plan-time 4
    expect(hub.calls.find((c) => c.op === 'setMode')?.expectEpoch).toBe(5);
  });

  test('a local failure after the flip leaves the save mode alone; the next Update finishes both', async () => {
    const hub = legacyFormat1();
    const o = opts(p as Project, { hub: owner, hubClient: hub.client });
    const dry = await planMigration(o);
    const blocker = path.join((p as Project).design, '_chat', 'chat-01.meta.json');
    hub.state.onSet = () => mkdirSync(blocker);
    await expect(applyMigration(o, dry)).rejects.toThrow();
    rmSync(blocker, { recursive: true });
    expect(hub.state.formatVersion).toBe(2);
    expect(localFormat(p as Project)).toBe(1); // rolled back
    expect(hub.state.mode).toBe('legacy'); // never switched while the files are not updated
    expect(hub.calls.some((c) => c.op === 'setMode')).toBe(false);
    hub.state.onSet = null;
    const again = await run(o);
    expect(again.exitCode).toBe(EXIT.done);
    expect(localFormat(p as Project)).toBe(2);
    expect(hub.state.mode).toBe('transactions');
  });

  test('format 2 + legacy is not "already at target": Update switches the mode only', async () => {
    const hub = await legacyFormat2();
    const o = opts(p as Project, { hub: owner, hubClient: hub.client });
    const dry = await planMigration(o);
    expect(dry.exitCode).toBe(EXIT.done);
    expect(dry.totals).toMatchObject({ modify: 0, create: 0, remove: 0 });
    const r = await applyMigration(o, dry);
    expect(r.exitCode).toBe(EXIT.done);
    expect(hub.calls.some((c) => c.op === 'setFormat')).toBe(false);
    expect(hub.state.mode).toBe('transactions');
    expect(r.project.linked?.modeSwitched).toBe(true);
    // and once it is accepted, Update has nothing left to do
    expect((await planMigration(o)).exitCode).toBe(EXIT.atTarget);
  });

  test('the switch fails after the format flip: the report says so, and a second Update completes it', async () => {
    const hub = legacyFormat1();
    hub.state.refuseMode = { status: 503, code: 'retryable' };
    const o = opts(p as Project, { hub: owner, hubClient: hub.client });
    const r = await run(o);
    expect(r.exitCode).toBe(EXIT.done); // the format DID move; the app reloads it
    expect(localFormat(p as Project)).toBe(2);
    expect(hub.state.mode).toBe('legacy');
    expect(r.project.linked).toMatchObject({ modeDue: true, modeSwitched: false });
    expect(r.notes?.join('\n')).toContain('format updated, still saving the old way');
    expect(r.notes?.join('\n')).toContain('run Update again');
    hub.state.refuseMode = null;
    const second = await run(o);
    expect(second.exitCode).toBe(EXIT.done);
    expect(second.project.linked?.modeSwitched).toBe(true);
    expect(hub.state.mode).toBe('transactions');
  });

  test('a stale epoch at the switch is read again once, not reported as a failure', async () => {
    const hub = await legacyFormat2();
    let bumped = false;
    hub.state.onSetMode = () => {
      if (bumped) return;
      bumped = true;
      hub.state.epoch += 1; // another writer moved the epoch between the read and the switch
    };
    const r = await run(opts(p as Project, { hub: owner, hubClient: hub.client }));
    expect(r.project.linked?.modeSwitched).toBe(true);
    expect(hub.calls.filter((c) => c.op === 'setMode')).toHaveLength(2);
  });

  test('an import that finishes late reads "switched, still bringing changes in" — not a failure', async () => {
    const hub = await legacyFormat2();
    hub.state.importLate = true;
    const r = await run(opts(p as Project, { hub: owner, hubClient: hub.client }));
    expect(r.exitCode).toBe(EXIT.done);
    expect(r.project.linked).toMatchObject({ modeSwitched: true, modeImporting: true });
    expect(r.notes?.join('\n')).toContain('still bringing changes in');
    expect(r.notes?.join('\n')).not.toContain('still saving the old way');
  });

  test('--reverse keeps accepted revisions', async () => {
    const hub = legacyFormat1();
    await run(opts(p as Project, { hub: owner, hubClient: hub.client }));
    expect(hub.state.mode).toBe('transactions');
    const r = await run(
      opts(p as Project, { direction: 'reverse', hub: owner, hubClient: hub.client })
    );
    expect(r.exitCode).toBe(EXIT.done);
    expect(hub.state.formatVersion).toBe(1);
    expect(hub.state.mode).toBe('transactions');
    expect(hub.calls.filter((c) => c.op === 'setMode')).toHaveLength(1); // only the forward one
  });
});

describe('Update project — refusals of the switch', () => {
  test('not the owner: refused before any change, mode untouched', async () => {
    const hub = await legacyFormat2();
    const r = await run(
      opts(p as Project, { hub: { ...owner, role: 'member' }, hubClient: hub.client })
    );
    expect(r.exitCode).toBe(EXIT.refused);
    expect(r.refusals.map((x) => x.code)).toContain('not-owner');
    expect(hub.calls.some((c) => c.op === 'setMode' || c.op === 'setMode:dry')).toBe(false);
    expect(hub.state.mode).toBe('legacy');
  });

  for (const code of ['browser-not-paired', 'store-not-durable'] as const) {
    test(`${code}, format 2: the Update is refused with that code, nothing changes`, async () => {
      const hub = await legacyFormat2();
      if (code === 'browser-not-paired') hub.state.blockers = ['browser-not-paired'];
      else hub.state.durable = false;
      const r = await run(opts(p as Project, { hub: owner, hubClient: hub.client }));
      expect(r.exitCode).toBe(EXIT.refused);
      expect(r.refusals.map((x) => x.code)).toContain(code);
      expect(r.project.linked).toMatchObject({ modeBlocker: code, modeSwitched: false });
      expect(hub.calls.some((c) => c.op === 'setMode')).toBe(false);
      expect(hub.state.mode).toBe('legacy');
    });

    test(`${code}, format 1: the format still updates; the report says saving stays the old way`, async () => {
      const hub = legacyFormat1();
      if (code === 'browser-not-paired') hub.state.blockers = ['browser-not-paired'];
      else hub.state.durable = false;
      const r = await run(opts(p as Project, { hub: owner, hubClient: hub.client }));
      expect(r.exitCode).toBe(EXIT.done);
      expect(localFormat(p as Project)).toBe(2);
      expect(hub.state.mode).toBe('legacy');
      expect(r.project.linked).toMatchObject({ modeBlocker: code, modeSwitched: false });
      expect(r.notes?.join('\n')).toContain('keeps saving the old way');
    });
  }

  test('the hub refuses the switch itself (403): the format stays updated, the report is honest', async () => {
    const hub = legacyFormat1();
    hub.state.refuseMode = { status: 403, code: 'forbidden' };
    const r = await run(opts(p as Project, { hub: owner, hubClient: hub.client }));
    expect(localFormat(p as Project)).toBe(2);
    expect(hub.state.mode).toBe('legacy');
    expect(r.project.linked?.modeSwitched).toBe(false);
    expect(r.notes?.join('\n')).toContain('forbidden');
  });

  test('an unlinked project has no save mode to switch', async () => {
    p = fixtureProject();
    const r = await run(opts(p));
    expect(r.exitCode).toBe(EXIT.done);
    expect(r.project.linked).toBe(null);
  });
});
