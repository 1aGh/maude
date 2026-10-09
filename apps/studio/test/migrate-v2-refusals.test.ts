// V2-1.12 §5.10 "Refuses (exit 11, nothing written)" — each refusal, with the
// full tree hash unchanged (runtime noise included).

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { applyMigration, EXIT, planMigration } from '../migrate/engine.ts';
import {
  fakeHub,
  fixtureProject,
  fullTreeHash,
  opts,
  type Project,
  run,
} from './_migrate-harness.ts';

let p: Project | null = null;
afterEach(() => {
  p?.dispose();
  p = null;
});

const cfgPath = () => path.join((p as Project).design, 'config.json');
const setConfig = (patch: Record<string, unknown>) => {
  const cfg = JSON.parse(readFileSync(cfgPath(), 'utf8'));
  writeFileSync(cfgPath(), `${JSON.stringify({ ...cfg, ...patch }, null, 2)}\n`);
};

async function refused(o = opts(p as Project), why: RegExp) {
  const h = fullTreeHash((p as Project).design);
  const r = await run(o);
  expect(r.exitCode).toBe(EXIT.refused);
  const reasons = [...r.refusals, ...r.steps.flatMap((s) => s.refusals)]
    .map((x) => `${x.path} ${x.reason}`)
    .join(' | ');
  expect(reasons).toMatch(why);
  expect(fullTreeHash((p as Project).design)).toBe(h);
  return r;
}

describe('maude migrate v2 — refusals', () => {
  test('a project newer than this build', async () => {
    p = fixtureProject();
    setConfig({ formatVersion: 3 });
    await refused(undefined, /format 3, newer than this build/);
  });

  test('config.json missing, or not JSON', async () => {
    p = fixtureProject();
    writeFileSync(cfgPath(), '{ not json');
    await refused(undefined, /config.json is not JSON/);
    rmSync(cfgPath());
    await refused(undefined, /config.json is missing/);
  });

  test('a board that would drop elements', async () => {
    p = fixtureProject();
    writeFileSync(
      path.join(p.design, 'ui-c00.annotations.json'),
      '{"format":"maude.annotations","v":2,"elements":[\n{"id":"bad","type":"sticky","index":"a0"}\n]}\n'
    );
    await refused(undefined, /ui-c00\.annotations\.json 1 element\(s\) would be dropped/);
  });

  test('a board newer than this build', async () => {
    p = fixtureProject();
    writeFileSync(
      path.join(p.design, 'ui-c00.annotations.json'),
      '{"format":"maude.annotations","v":3,"elements":[]}\n'
    );
    await refused(undefined, /newer than this client/);
  });

  test('a .meta.json that is not an object', async () => {
    p = fixtureProject();
    writeFileSync(path.join(p.design, 'ui', 'c00.meta.json'), '[1, 2]\n');
    await refused(undefined, /ui\/c00\.meta\.json not a JSON object/);
  });

  test('a studio has the project open (apply only; the dry run is fine; the app itself may)', async () => {
    p = fixtureProject();
    const live = opts(p, { liveStudio: () => true });
    expect((await planMigration(live)).exitCode).toBe(EXIT.done);
    await refused(live, /Close the project in Maude, or use Update project in the app/);
    const viaApp = await run({ ...live, viaStudio: true });
    expect(viaApp.exitCode).toBe(EXIT.done);
  });

  test('linked: not the owner · no format-v2 · unreachable · no credential · a stale epoch', async () => {
    p = fixtureProject();
    setConfig({ linkedHub: { url: 'https://hub.example', linkedAt: 1 } });
    const hub = fakeHub({ formatVersion: 1 });
    await refused(
      opts(p, {
        hub: { url: 'https://hub.example', token: 't', role: 'editor' },
        hubClient: hub.client,
      }),
      /only the project's owner/
    );
    const old = fakeHub({ formatVersion: null, capabilities: ['ledger', 'annotations-v2'] });
    await refused(
      opts(p, {
        hub: { url: 'https://hub.example', token: 't', role: 'owner' },
        hubClient: old.client,
      }),
      /team server needs an update/
    );
    const down = fakeHub({ formatVersion: 1, reachable: false });
    await refused(
      opts(p, {
        hub: { url: 'https://hub.example', token: 't', role: 'owner' },
        hubClient: down.client,
      }),
      /cannot be reached/
    );
    await refused(opts(p, { hub: null }), /no sign-in for its team server/);
    const stale = fakeHub({ formatVersion: 1 });
    stale.state.refuse = { status: 409, code: 'epoch-stale' };
    await refused(
      opts(p, {
        hub: { url: 'https://hub.example', token: 't', role: 'owner' },
        hubClient: stale.client,
      }),
      /refused the update \(epoch-stale\)/
    );
  });

  test('--reverse on a project that is not at format 2', async () => {
    p = fixtureProject();
    await refused(opts(p, { direction: 'reverse' }), /not at format 2/);
  });

  test('the tree changed between the dry run and the apply', async () => {
    p = fixtureProject();
    const o = opts(p);
    const dry = await planMigration(o);
    writeFileSync(path.join(p.design, 'ui', 'c00.meta.json'), '{"title":"edited meanwhile"}\n');
    const h = fullTreeHash(p.design);
    const r = await applyMigration(o, dry);
    expect(r.exitCode).toBe(EXIT.refused);
    expect(r.refusals.map((x) => x.reason)).toEqual([
      'the project changed since the dry run — run it again',
    ]);
    expect(fullTreeHash(p.design)).toBe(h);
  });

  test('another live migration holds the lock', async () => {
    p = fixtureProject();
    const lock = path.join(p.design, '_state', 'migrate-v2.lock');
    writeFileSync(lock, `${process.ppid}\n`); // a live pid that is not us
    await refused(undefined, /another migration of this project is running/);
    rmSync(lock);
  });
});
