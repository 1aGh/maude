// V2-1.12 I7 — hub order: forward flips the hub BEFORE the first local write;
// reverse unflips it AFTER the last; a crash between resumes (M13), and a
// first link of a local format-2 project raises the hub (M12).

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

describe('maude migrate v2 — hub order', () => {
  test('forward: the hub flips before the first local write', async () => {
    p = fixtureProject();
    link(p);
    const hub = fakeHub({ formatVersion: 1 });
    const seen: number[] = [];
    hub.state.onSet = () => seen.push(localFormat(p as Project));
    const r = await run(opts(p, { hub: owner, hubClient: hub.client }));
    expect(r.exitCode).toBe(EXIT.done);
    expect(seen).toEqual([1]); // nothing local was written yet when the hub moved
    expect(hub.state.formatVersion).toBe(2);
    expect(localFormat(p)).toBe(2);
    expect(r.project.linked).toMatchObject({ hub: HUB, role: 'owner', hubFormat: 1 });
  });

  test('reverse: the hub unflips after the last local write', async () => {
    p = fixtureProject();
    link(p);
    const hub = fakeHub({ formatVersion: 1 });
    await run(opts(p, { hub: owner, hubClient: hub.client }));
    const seen: number[] = [];
    hub.state.onSet = () => seen.push(localFormat(p as Project));
    const r = await run(opts(p, { direction: 'reverse', hub: owner, hubClient: hub.client }));
    expect(r.exitCode).toBe(EXIT.done);
    expect(seen).toEqual([1]); // the local marker was already gone
    expect(hub.state.formatVersion).toBe(1);
  });

  test('M13: a crash after the hub flip, before the local marker → the next run completes', async () => {
    p = fixtureProject();
    link(p);
    const hub = fakeHub({ formatVersion: 1 });
    const o = opts(p, { hub: owner, hubClient: hub.client });
    const dry = await planMigration(o);
    // After the flip, one local write is made impossible: a directory where a
    // chat's new meta file has to go. The run fails mid-way and rolls back.
    const blocker = path.join(p.design, '_chat', 'chat-01.meta.json');
    hub.state.onSet = () => mkdirSync(blocker);
    await expect(applyMigration(o, dry)).rejects.toThrow();
    rmSync(blocker, { recursive: true });
    expect(hub.state.formatVersion).toBe(2); // flipped
    expect(localFormat(p)).toBe(1); // rolled back locally — all or nothing
    hub.state.onSet = null;
    const again = await run(o);
    expect(again.exitCode).toBe(EXIT.done);
    expect(localFormat(p)).toBe(2);
    expect(hub.calls.filter((c) => c.op === 'setFormat')).toHaveLength(1); // not flipped twice
  });

  test('M12: a local format-2 project linked to a format-1 hub raises the hub', async () => {
    p = fixtureProject();
    await run(opts(p)); // local → 2
    link(p);
    const hub = fakeHub({ formatVersion: 1 });
    const r = await run(opts(p, { hub: owner, hubClient: hub.client }));
    expect(r.exitCode).toBe(EXIT.done);
    expect(r.steps.find((s) => s.id === 'project.marker')?.notes).toContain(
      'the team server moves to format 2'
    );
    expect(hub.state.formatVersion).toBe(2);
  });

  test('a reverse that stopped before the unflip finishes on the next run', async () => {
    p = fixtureProject();
    link(p);
    const hub = fakeHub({ formatVersion: 1 });
    await run(opts(p, { hub: owner, hubClient: hub.client }));
    hub.state.refuse = { status: 503, code: 'switch-in-progress' };
    const first = await run(opts(p, { direction: 'reverse', hub: owner, hubClient: hub.client }));
    expect(first.exitCode).toBe(EXIT.error);
    expect(localFormat(p)).toBe(1);
    expect(hub.state.formatVersion).toBe(2);
    hub.state.refuse = null;
    const second = await run(opts(p, { direction: 'reverse', hub: owner, hubClient: hub.client }));
    expect(second.exitCode).toBe(EXIT.done);
    expect(hub.state.formatVersion).toBe(1);
  });
});
