// S5.1b — the in-process kernel for local projects (S5-kernel-foundation §4).
//
// A real kernel over a real `bun:sqlite` store in a temp project. The oracle is
// the disk and the store: what history answers, what the files hold after an
// undo / restore, which store file a second machine or a second studio writes.

import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  acquireStoreLock,
  BASELINE_KIND,
  canvasOfRel,
  GZIP_CODEC,
  LOCK_FILE,
  type LocalHome,
  OUTSIDE_KIND,
  openLocalHome,
  STORE_FILE,
  withLocalHome,
} from '../sync/local-kernel.ts';

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const tsx = (text: string) => `export default () => <p>${text}</p>;\n`;
const M1 = { id: 'm_mac_one', name: 'Mac one' };
const M2 = { id: 'm_mac_two', name: 'Mac two' };
const quiet = { warn() {}, error() {} };

function project(
  canvases: Record<string, string> = { 'ui/a.tsx': tsx('a0'), 'ui/b.tsx': tsx('b0') }
) {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-local-kernel-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  for (const [rel, body] of Object.entries(canvases)) {
    mkdirSync(path.dirname(path.join(designRoot, rel)), { recursive: true });
    writeFileSync(path.join(designRoot, rel), body);
  }
  const file = (rel: string) => path.join(designRoot, rel);
  return {
    root,
    designRoot,
    file,
    read: (rel: string) => readFileSync(file(rel), 'utf8'),
    write: (rel: string, body: string) => writeFileSync(file(rel), body),
  };
}

function open(designRoot: string, extra: Partial<Parameters<typeof openLocalHome>[0]> = {}) {
  const h = openLocalHome({
    designRoot,
    designRel: '.design',
    canvasGroups: () => [{ path: 'ui' }],
    machine: M1,
    bootId: 'boot-1',
    lockRetryMs: 0,
    settleMs: 5,
    log: quiet,
    ...extra,
  });
  homes.push(h);
  return h;
}

describe('a local project answers from _state/project-store.sqlite', () => {
  test('the first boot imports every canvas as one migration.import action (C3)', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    expect(existsSync(path.join(p.designRoot, '_state', STORE_FILE))).toBe(true);
    const rows = await h.runtime.acceptedHistory({});
    expect(rows.map((r) => [r.kind, r.canvases])).toEqual([
      [BASELINE_KIND, ['ui/b.tsx']],
      [BASELINE_KIND, ['ui/a.tsx']],
    ]);
    expect(rows.every((r) => r.label === 'Version history starts here' && !r.mine)).toBe(true);
    // A second boot imports nothing again.
    h.close();
    const again = open(p.designRoot);
    await again.ready();
    expect((await again.runtime.acceptedHistory({})).length).toBe(2);
  });

  test('a watched edit becomes an outside action; undo puts the file back, redo re-applies (U21)', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    p.write('ui/a.tsx', tsx('a1'));
    h.observe('ui/a.tsx');
    await h.flush();
    const [edit] = await h.runtime.acceptedHistory({});
    expect(edit.kind).toBe(OUTSIDE_KIND);
    expect(edit.mine).toBe(true);
    expect(edit.canvases).toEqual(['ui/a.tsx']);

    const undo = await h.runtime.acceptedUndo(edit.actionId);
    expect(undo.status).toBe('accepted');
    expect(p.read('ui/a.tsx')).toBe(tsx('a0'));
    // The write's own echo through the watcher records nothing.
    h.observe('ui/a.tsx');
    await h.flush();
    const afterUndo = await h.runtime.acceptedHistory({});
    expect(afterUndo[0].kind).toBe('undo');
    expect(afterUndo[0].undoes).toBe(edit.actionId);

    const redo = await h.runtime.acceptedUndo(undo.actionId as string, true);
    expect(redo.status).toBe('accepted');
    expect(p.read('ui/a.tsx')).toBe(tsx('a1'));
  });

  test('restore is a new version; the old one reads back by revision', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    const base = (await h.runtime.acceptedHistory({ path: '.design/ui/a.tsx' }))[0];
    p.write('ui/a.tsx', tsx('a2'));
    h.observe('ui/a.tsx');
    expect(await h.runtime.acceptedVersion('.design/ui/a.tsx', base.revision)).toBe(tsx('a0'));
    const r = await h.runtime.acceptedRestore('.design/ui/a.tsx', base.revision);
    expect(r.status).toBe('accepted');
    expect(p.read('ui/a.tsx')).toBe(tsx('a0'));
    const rows = await h.runtime.acceptedHistory({ path: '.design/ui/a.tsx' });
    expect(rows.map((x) => x.kind)).toEqual(['history.restore', OUTSIDE_KIND, BASELINE_KIND]);
    expect(rows[0].label).toBe(`Restore a to version ${base.revision}`);
    // b was not touched by any of it.
    expect((await h.runtime.acceptedHistory({ path: '.design/ui/b.tsx' })).length).toBe(1);
  });

  test('an undo never overwrites bytes on disk the store did not accept', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    p.write('ui/a.tsx', tsx('a1'));
    h.observe('ui/a.tsx');
    await h.flush();
    const [edit] = await h.runtime.acceptedHistory({});
    // Half-typed: the source gate refuses it, so it is never recorded.
    p.write('ui/a.tsx', 'export default () => <p>');
    h.observe('ui/a.tsx');
    await h.flush();
    expect((await h.runtime.acceptedHistory({}))[0].actionId).toBe(edit.actionId);
    await h.runtime.acceptedUndo(edit.actionId);
    expect(p.read('ui/a.tsx')).toBe('export default () => <p>');
  });

  test('create, delete and the meta lane are watched; a deleted canvas comes back on undo', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    p.write('ui/c.tsx', tsx('c0'));
    p.write('ui/c.meta.json', `${JSON.stringify({ title: 'Cee' }, null, 2)}\n`);
    h.observe('ui/c.tsx');
    h.observe('ui/c.meta.json');
    await h.flush();
    expect((await h.runtime.acceptedHistory({}))[0].canvases).toEqual(['ui/c.tsx']);
    rmSync(p.file('ui/c.tsx'));
    rmSync(p.file('ui/c.meta.json'));
    h.observe('ui/c.tsx');
    await h.flush();
    const [del] = await h.runtime.acceptedHistory({});
    expect(del.kind).toBe(OUTSIDE_KIND);
    expect((await h.runtime.acceptedUndo(del.actionId)).status).toBe('accepted');
    expect(p.read('ui/c.tsx')).toBe(tsx('c0'));
    expect(JSON.parse(p.read('ui/c.meta.json')).title).toBe('Cee');
  });

  test('lane bodies are gzip-coded in the store (C4)', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    h.close();
    const db = new Database(path.join(p.designRoot, '_state', STORE_FILE), { readonly: true });
    const bodies = db.query(`SELECT body FROM blobs WHERE size > 0`).all() as { body: unknown }[];
    db.close();
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) {
      expect(b.body).toBeInstanceOf(Uint8Array);
      expect(GZIP_CODEC.decode(b.body)).toContain('export default');
    }
    expect(GZIP_CODEC.decode('plain text row')).toBe('plain text row');
  });

  test('a reopen keeps revisions and fence counters', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    const P = { canvas: 'e-post', artboard: 'post-1-1' };
    const begin = (actor: string, runId: string) =>
      h.store().runsBegin({
        runId,
        askId: `a_${runId.slice(2)}`,
        actor,
        device: `${actor}-mac`,
        origin: 'maude-chat',
        label: 'x',
        wants: [P],
        enqueue: true,
      });
    expect((await begin('michal', 'r_michal01')).granted).toEqual([{ ...P, token: 1 }]);
    await begin('tereza', 'r_tereza01');
    const before = await h.store().state();
    h.close();
    const two = open(p.designRoot);
    await two.ready();
    expect((await two.store().state()).revision).toBe(before.revision);
    expect((await two.store().state()).epoch).toBe(before.epoch);
    const end = await two
      .store()
      .runsEnd({ runId: 'r_michal01', actor: 'michal', outcome: 'done' });
    expect(end.granted).toEqual([{ runId: 'r_tereza01', ...P, token: 2 }]);
  });
});

describe('one writer per folder (C2)', () => {
  test('a second studio on the same folder is refused by the lock and reads only', async () => {
    const p = project();
    const a = open(p.designRoot);
    await a.ready();
    const b = open(p.designRoot);
    await b.ready();
    expect(a.mode()).toBe('writer');
    expect(b.mode()).toBe('read-only');
    expect((await b.runtime.acceptedHistory({})).length).toBe(2);
    const [row] = await b.runtime.acceptedHistory({});
    expect(await b.runtime.acceptedUndo(row.actionId)).toEqual({
      status: 'rejected',
      code: 'store-locked',
    });
    expect((await b.runtime.acceptedRestore('.design/ui/a.tsx', 1)).code).toBe('store-locked');
    // Its watcher records nothing — the writer's does.
    p.write('ui/a.tsx', tsx('a9'));
    b.observe('ui/a.tsx');
    await b.flush();
    expect((await a.runtime.acceptedHistory({})).length).toBe(2);
  });

  test('when the writer goes, the waiting studio takes the lock', async () => {
    const p = project();
    const a = open(p.designRoot);
    await a.ready();
    const b = open(p.designRoot, { lockRetryMs: 20 });
    expect(b.mode()).toBe('read-only');
    a.close();
    for (let i = 0; i < 50 && b.mode() !== 'writer'; i++) await Bun.sleep(20);
    expect(b.mode()).toBe('writer');
    await b.ready();
    p.write('ui/a.tsx', tsx('a3'));
    b.observe('ui/a.tsx');
    await b.flush();
    expect((await b.runtime.acceptedHistory({}))[0].kind).toBe(OUTSIDE_KIND);
  });

  test('a stale lock (gone pid, other boot, other machine) is taken over', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'maude-lock-'));
    dirs.push(dir);
    const f = path.join(dir, LOCK_FILE);
    const me = { pid: process.pid, bootId: 'boot-1', machine: M1.id };
    for (const stale of [
      { ...me, pid: 2 ** 22 + 7 }, // no such pid
      { ...me, bootId: 'boot-0' },
      { ...me, machine: M2.id },
      'torn{',
    ]) {
      writeFileSync(f, typeof stale === 'string' ? stale : JSON.stringify({ ...stale, at: 1 }));
      const got = acquireStoreLock(f, me);
      expect(got.held).toBe(true);
      if (got.held) got.release();
      expect(existsSync(f)).toBe(false);
    }
    const first = acquireStoreLock(f, me);
    expect(first.held).toBe(true);
    expect(acquireStoreLock(f, me).held).toBe(false);
    if (first.held) first.release();
  });
});

describe('one machine per store (C1)', () => {
  test('a store another machine wrote is moved aside, never written, and listed read-only', async () => {
    const p = project();
    const one = open(p.designRoot, { machine: M1 });
    await one.ready();
    p.write('ui/a.tsx', tsx('a1'));
    one.observe('ui/a.tsx');
    await one.flush();
    one.close();
    // The folder is copied to Mac two (Syncthing, cp -R).
    const two = open(p.designRoot, { machine: M2 });
    await two.ready();
    const stateDir = path.join(p.designRoot, '_state');
    const foreignFile = path.join(stateDir, `project-store.${M1.id}.sqlite`);
    expect(existsSync(foreignFile)).toBe(true);
    const sizeBefore = statSync(foreignFile).size;
    // Mac two starts its own store with a baseline of what it has now.
    const mine = await two.runtime.acceptedHistory({});
    expect(mine.map((r) => r.kind)).toEqual([BASELINE_KIND, BASELINE_KIND]);
    p.write('ui/a.tsx', tsx('a2'));
    two.observe('ui/a.tsx');
    await two.flush();
    expect(two.foreignStores()).toEqual([{ machine: M1.id, name: 'Mac one', file: foreignFile }]);
    const theirs = await two.foreignHistory(M1.id);
    expect(theirs?.map((r) => r.kind)).toEqual([OUTSIDE_KIND, BASELINE_KIND, BASELINE_KIND]);
    expect(theirs?.every((r) => !r.mine)).toBe(true);
    two.close();
    expect(statSync(foreignFile).size).toBe(sizeBefore);
    expect(
      readdirSync(stateDir)
        .filter((n) => n.endsWith('.sqlite'))
        .sort()
    ).toEqual([`project-store.${M1.id}.sqlite`, STORE_FILE]);
  });
});

describe('syncControl wiring (foundation §5)', () => {
  test('current() is the hub runtime when one runs, the local home only while unlinked', async () => {
    const p = project();
    const h = open(p.designRoot);
    let hub: object | null = null;
    let linked = false;
    const sup = { current: () => hub, busy: () => false };
    const ctl = withLocalHome(
      sup,
      () => h,
      () => !linked
    );
    expect(ctl.current()).toBe(h.runtime);
    expect(ctl.busy()).toBe(false);
    linked = true; // linked, runtime not (yet) running: the hub's answer, as today
    expect(ctl.current()).toBeNull();
    hub = { acceptedHistory: async () => null };
    expect(ctl.current()).toBe(hub);
  });

  test('the watcher maps body, meta and board files to their canvas', () => {
    expect(canvasOfRel('ui/a.tsx')).toBe('ui/a.tsx');
    expect(canvasOfRel('ui/a.meta.json')).toBe('ui/a.tsx');
    expect(canvasOfRel('ui/a.annotations.json')).toBe('ui/a.tsx');
    expect(canvasOfRel('_state/project-store.sqlite-wal')).toBeNull();
    expect(canvasOfRel('_draw/x.proof.tsx')).toBeNull();
    expect(canvasOfRel('ui/a.css')).toBeNull();
  });
});
