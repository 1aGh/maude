// feature-before-first-external-users Task 3 (F-6) — `_trash/` scanner,
// restore, prune. The scanner derives everything from the on-disk shapes the
// five real writers produce, so each fixture below mirrors one writer.

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listTrash, pruneTrash, restoreFromTrash } from '../sync/trash.ts';

const DAY = 24 * 60 * 60 * 1000;

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'maude-trash-'));
}

function put(root: string, rel: string, body = 'x'): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, body);
}

describe('listTrash — one entry per writer shape', () => {
  test('empty / absent _trash/ lists nothing', () => {
    expect(listTrash(makeRoot())).toEqual([]);
  });

  test('the file plane quarantine (`<stamp>/<rel>`) derives source + park time', () => {
    const root = makeRoot();
    put(root, '_trash/2026-08-20T14-11-19-940Z/ui/Hero.tsx', 'body');
    const [e] = listTrash(root);
    expect(e.sourceRel).toBe('ui/Hero.tsx');
    expect(e.reason).toBe('removed');
    expect(e.at).toBe(Date.parse('2026-08-20T14:11:19.940Z'));
    expect(e.size).toBe(4);
  });

  test('an LWW conflict loser (`<rel>-conflict-<ts>`) derives its own path', () => {
    const root = makeRoot();
    put(root, '_trash/ui/Hero.tsx-conflict-1755700000000');
    const [e] = listTrash(root);
    expect(e.sourceRel).toBe('ui/Hero.tsx');
    expect(e.reason).toBe('conflict');
    expect(e.at).toBe(1755700000000);
  });

  test('moved / deleted / migration shapes are named and dated, source honest-null', () => {
    const root = makeRoot();
    put(root, '_trash/2026-08-20T10-00-00-000Z__moved-hero/hero.tsx');
    put(root, '_trash/hero-deleted-1755700000001/hero.tsx');
    put(root, '_trash/hero-flat-1755700000002');
    const entries = listTrash(root);
    expect(entries.map((e) => e.reason).sort()).toEqual(['deleted', 'migration', 'moved']);
    for (const e of entries) expect(e.sourceRel).toBeNull();
  });

  test('an unrecognized shape still lists, as unknown — never invisible', () => {
    const root = makeRoot();
    put(root, '_trash/whatever.bin');
    const [e] = listTrash(root);
    expect(e.reason).toBe('unknown');
    expect(e.sourceRel).toBeNull();
  });
});

// S1.2 — a canvas moved to the trash (api.deleteCanvas) parks a bundle `<stamp>__<slug>/` that records its
// own way home in `_trash-manifest.json`; the toast's Undo restores it file by file through this same route.
describe('a canvas bundle (`<stamp>__<slug>/` + `_trash-manifest.json`)', () => {
  const STAMP = '2026-10-18T10-00-00-000Z';
  const DIR = `_trash/${STAMP}__ui-hero`;
  function bundle(root: string): void {
    put(root, `${DIR}/Hero.tsx`, 'tsx');
    put(root, `${DIR}/Hero.meta.json`, '{}');
    put(root, `${DIR}/_history__ui-hero/snap-1.tsx`, 'old');
    put(root, `${DIR}/_canvas-state__ui-hero.view.json`, '{}');
    put(
      root,
      `${DIR}/_trash-manifest.json`,
      JSON.stringify({
        canvas: 'ui/Hero.tsx',
        slug: 'ui-hero',
        trashed: [
          'ui/Hero.tsx',
          'ui/Hero.meta.json',
          '_history/ui-hero',
          '_canvas-state/ui-hero.view.json',
        ],
      })
    );
  }

  test('every file of the bundle knows where it came from', () => {
    const root = makeRoot();
    bundle(root);
    const by = new Map(listTrash(root).map((e) => [e.trashRel, e]));
    expect(by.get(`${DIR}/Hero.tsx`)?.sourceRel).toBe('ui/Hero.tsx');
    expect(by.get(`${DIR}/Hero.meta.json`)?.sourceRel).toBe('ui/Hero.meta.json');
    expect(by.get(`${DIR}/_history__ui-hero/snap-1.tsx`)?.sourceRel).toBe(
      '_history/ui-hero/snap-1.tsx'
    );
    expect(by.get(`${DIR}/_canvas-state__ui-hero.view.json`)?.sourceRel).toBe(
      '_canvas-state/ui-hero.view.json'
    );
    expect(by.get(`${DIR}/Hero.tsx`)?.reason).toBe('deleted');
    expect(by.get(`${DIR}/Hero.tsx`)?.at).toBe(Date.parse('2026-10-18T10:00:00.000Z'));
    // the bookkeeping file is not something to restore
    expect(by.get(`${DIR}/_trash-manifest.json`)?.sourceRel).toBeNull();
  });

  test('restoring each file puts the canvas back', () => {
    const root = makeRoot();
    bundle(root);
    for (const e of listTrash(root).filter((x) => x.sourceRel)) {
      expect(restoreFromTrash(root, e.trashRel).ok).toBe(true);
    }
    expect(readFileSync(join(root, 'ui/Hero.tsx'), 'utf8')).toBe('tsx');
    expect(readFileSync(join(root, '_history/ui-hero/snap-1.tsx'), 'utf8')).toBe('old');
  });

  test('a manifest that points outside the design root derives nothing', () => {
    const root = makeRoot();
    put(root, `${DIR}/Hero.tsx`, 'tsx');
    put(
      root,
      `${DIR}/_trash-manifest.json`,
      JSON.stringify({ canvas: 'x', trashed: ['../../etc/Hero.tsx'] })
    );
    expect(listTrash(root).find((e) => e.trashRel === `${DIR}/Hero.tsx`)?.sourceRel).toBeNull();
  });

  test('an artboard bundle (kind: artboard) is left as it was', () => {
    const root = makeRoot();
    put(root, `_trash/${STAMP}__ui-hero__a1/a1.artboard.tsx`, 'block');
    put(
      root,
      `_trash/${STAMP}__ui-hero__a1/_trash-manifest.json`,
      JSON.stringify({ kind: 'artboard', canvas: 'ui/Hero.tsx', artboard: 'a1' })
    );
    for (const e of listTrash(root)) expect(e.sourceRel).toBeNull();
  });
});

describe('restoreFromTrash', () => {
  test('moves the file back to its derived source', () => {
    const root = makeRoot();
    put(root, '_trash/2026-08-20T14-11-19-940Z/ui/Hero.tsx', 'body');
    const res = restoreFromTrash(root, '_trash/2026-08-20T14-11-19-940Z/ui/Hero.tsx');
    expect(res.ok).toBe(true);
    expect(res.restoredTo).toBe('ui/Hero.tsx');
    expect(readFileSync(join(root, 'ui/Hero.tsx'), 'utf8')).toBe('body');
    expect(existsSync(join(root, '_trash/2026-08-20T14-11-19-940Z/ui/Hero.tsx'))).toBe(false);
  });

  test('never overwrites a newer copy — lands beside it as .restored-<ts>', () => {
    const root = makeRoot();
    put(root, 'ui/Hero.tsx', 'NEWER');
    put(root, '_trash/ui/Hero.tsx-conflict-1755700000000', 'older');
    const res = restoreFromTrash(root, '_trash/ui/Hero.tsx-conflict-1755700000000');
    expect(res.ok).toBe(true);
    expect(res.restoredTo).toMatch(/^ui\/Hero\.tsx\.restored-\d+$/);
    expect(readFileSync(join(root, 'ui/Hero.tsx'), 'utf8')).toBe('NEWER');
  });

  test('a shape with no derivable source refuses with guidance, not a guess', () => {
    const root = makeRoot();
    put(root, '_trash/hero-deleted-1755700000001/hero.tsx');
    const res = restoreFromTrash(root, '_trash/hero-deleted-1755700000001/hero.tsx');
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('original location is not recorded');
  });

  test('containment: traversal and non-_trash paths are refused', () => {
    const root = makeRoot();
    put(root, '_trash/x-conflict-1755700000000');
    expect(restoreFromTrash(root, '../outside').ok).toBe(false);
    expect(restoreFromTrash(root, '_trash/../ui/Hero.tsx').ok).toBe(false);
    expect(restoreFromTrash(root, 'ui/Hero.tsx').ok).toBe(false);
  });
});

describe('pruneTrash', () => {
  test('removes only entries older than the window, reports both halves', () => {
    const root = makeRoot();
    const now = 1755700000000;
    put(root, `_trash/old.txt-conflict-${now - 40 * DAY}`, '12345');
    put(root, `_trash/new.txt-conflict-${now - 5 * DAY}`, '123');
    const res = pruneTrash(root, 30, now);
    expect(res).toEqual({ pruned: 1, bytes: 5, kept: 1 });
    expect(listTrash(root)).toHaveLength(1);
    expect(listTrash(root)[0].sourceRel).toBe('new.txt');
  });

  test('sweeps directories left empty by the prune', () => {
    const root = makeRoot();
    const now = Date.parse('2026-08-20T00:00:00Z');
    put(root, '_trash/2026-01-01T00-00-00-000Z/ui/Old.tsx');
    pruneTrash(root, 30, now);
    expect(existsSync(join(root, '_trash/2026-01-01T00-00-00-000Z'))).toBe(false);
    expect(existsSync(join(root, '_trash'))).toBe(true); // the root folder stays
  });

  test('a prune inside the window removes nothing', () => {
    const root = makeRoot();
    const now = 1755700000000;
    put(root, `_trash/keep.txt-conflict-${now - 2 * DAY}`);
    expect(pruneTrash(root, 30, now)).toEqual({ pruned: 0, bytes: 0, kept: 1 });
  });
});
