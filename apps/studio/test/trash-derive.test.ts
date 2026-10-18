// S1.7 — the shared Trash is DERIVED from the one op log (S1 Q2, S1-trash.md §1):
// a deleted canvas is in it, a moved one is not; an artboard that came back to its
// canvas's source drops out; a cleared item stays gone. Over a real local home
// (S5.1's store, S1.6's ops) and over the pure derivation.

import { afterAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { deriveTrash, type TrashListing } from '../history/trash.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const board = (...ids: string[]) =>
  `export default () => (<>\n${ids.map((id) => `<DCArtboard id="${id}" width={100} height={100}><p>${id}</p></DCArtboard>`).join('\n')}\n</>);\n`;

function localProject(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-trash-derive-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  for (const [rel, body] of Object.entries(files)) writeFileSync(path.join(designRoot, rel), body);
  const home = openLocalHome({
    designRoot,
    designRel: '.design',
    canvasGroups: () => [{ path: 'ui' }],
    machine: { id: 'm_trash', name: 'Mac' },
    bootId: 'boot-t',
    lockRetryMs: 0,
    settleMs: 5,
    log: { warn() {}, error() {} },
  });
  homes.push(home);
  const abs = (rel: string) => path.join(designRoot, rel);
  return {
    home,
    abs,
    read: (rel: string) => readFileSync(abs(rel), 'utf8'),
    remove: async (rel: string) => {
      unlinkSync(abs(rel));
      home.observe(rel);
      await home.flush();
    },
    write: async (rel: string, body: string) => {
      writeFileSync(abs(rel), body);
      home.observe(rel);
      await home.flush();
    },
    move: async (from: string, to: string) => {
      writeFileSync(abs(to), readFileSync(abs(from)));
      unlinkSync(abs(from));
      home.observeMove(from, to);
      await home.flush();
    },
  };
}

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('deriveTrash (pure)', () => {
  const listing = (): TrashListing => ({
    canvases: [
      {
        id: 'canvas:n_b',
        entry: 'n_b',
        doc: 'ui-b',
        path: 'ui/b.tsx',
        rev: 4,
        actionId: 'a4',
        actor: 'jonas',
        at: at(2026, 10, 18, 9),
      },
    ],
    artboards: [
      // back in its canvas's source (a ⌘Z of the trash action) → dropped
      {
        id: 'artboard:a3/Back',
        entry: 'n_a',
        doc: 'ui-a',
        artboard: 'Back',
        label: 'Back',
        rev: 3,
        actionId: 'a3',
        actor: 'jonas',
        at: at(2026, 10, 17),
      },
      // still gone → listed at its canvas's live path
      {
        id: 'artboard:a3/Gone',
        entry: 'n_a',
        doc: 'ui-a',
        artboard: 'Gone',
        label: 'Gone',
        rev: 3,
        actionId: 'a3',
        actor: 'jonas',
        at: at(2026, 10, 17),
      },
      // its canvas is in the Trash too → listed, flagged
      {
        id: 'artboard:a2/X',
        entry: 'n_b',
        doc: 'ui-b',
        artboard: 'X',
        label: null,
        rev: 2,
        actionId: 'a2',
        actor: 'eva',
        at: at(2026, 10, 16),
      },
      // its canvas was cleared out → gone with it
      {
        id: 'artboard:a1/Y',
        entry: 'n_c',
        doc: 'ui-c',
        artboard: 'Y',
        label: null,
        rev: 1,
        actionId: 'a1',
        actor: 'eva',
        at: at(2026, 10, 15),
      },
    ],
    live: { n_a: { doc: 'ui-a2', path: 'ui/renamed.tsx' } },
  });

  test('drops what came back, keeps what is gone, newest first, Today / Earlier', () => {
    const reads: string[] = [];
    const items = deriveTrash(listing(), {
      readSource: (p) => {
        reads.push(p);
        return p === 'ui/renamed.tsx' ? board('Back', 'Other') : null;
      },
      now: at(2026, 10, 18, 15),
    });
    expect(items.map((i) => i.id)).toEqual(['canvas:n_b', 'artboard:a3/Gone', 'artboard:a2/X']);
    expect(items.map((i) => i.group)).toEqual(['today', 'earlier', 'earlier']);
    expect(items[1]).toMatchObject({ kind: 'artboard', path: 'ui/renamed.tsx', label: 'Gone' });
    expect(items[2]).toMatchObject({ path: 'ui/b.tsx', canvasTrashed: true });
    // one read per live canvas, however many of its artboards are listed
    expect(reads).toEqual(['ui/renamed.tsx']);
  });

  test('an unreadable source keeps the artboard listed (it is not known to be back)', () => {
    const items = deriveTrash(listing(), { readSource: () => null, now: at(2026, 10, 18) });
    expect(items.map((i) => i.id)).toContain('artboard:a3/Back');
  });

  test('a malformed id from a home is never served', () => {
    const l = listing();
    l.canvases.push({ ...l.canvases[0], id: 'canvas:../x', entry: '../x' } as never);
    const items = deriveTrash(l, { readSource: () => null });
    expect(items.some((i) => i.id === 'canvas:../x')).toBe(false);
  });
});

describe('the local home derives the Trash from its store', () => {
  test('a deleted canvas is in the Trash; a moved one is not', async () => {
    const p = localProject({ 'ui/a.tsx': board('A1'), 'ui/b.tsx': board('B1') });
    await p.home.ready();
    await p.move('ui/a.tsx', 'ui/a-moved.tsx');
    await p.remove('ui/b.tsx');
    const listing = await p.home.runtime.acceptedTrash();
    expect(listing).not.toBeNull();
    const items = deriveTrash(listing as TrashListing, { readSource: () => null });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'canvas', path: 'ui/b.tsx', group: 'today' });
    expect(items[0]?.id).toMatch(/^canvas:/);
  });

  test('restore brings the canvas back in place, with the same entry', async () => {
    const p = localProject({ 'ui/b.tsx': board('B1') });
    await p.home.ready();
    await p.remove('ui/b.tsx');
    const [item] = deriveTrash((await p.home.runtime.acceptedTrash()) as TrashListing, {
      readSource: () => null,
    });
    const entry = String(item?.id).slice('canvas:'.length);
    const r = await p.home.runtime.acceptedTrashRestore(entry);
    expect(r).toMatchObject({ status: 'accepted', path: 'ui/b.tsx' });
    expect(p.read('ui/b.tsx')).toBe(board('B1'));
    expect((await p.home.runtime.acceptedTrash())?.canvases).toEqual([]);
    const [row] = await p.home.runtime.acceptedHistory({ limit: 1 });
    expect(row).toMatchObject({ kind: 'restore', label: 'Restored “b” from the trash' });
  });

  test('a taken path restores as "<name> 2"; a re-created canvas at the path does not hide the trashed one', async () => {
    const p = localProject({ 'ui/b.tsx': board('Old') });
    await p.home.ready();
    await p.remove('ui/b.tsx');
    await p.write('ui/b.tsx', board('New'));
    const listing = (await p.home.runtime.acceptedTrash()) as TrashListing;
    expect(listing.canvases).toHaveLength(1);
    const entry = listing.canvases[0]?.entry as string;
    const r = await p.home.runtime.acceptedTrashRestore(entry);
    expect(r).toMatchObject({ status: 'accepted', path: 'ui/b 2.tsx' });
    expect(p.read('ui/b 2.tsx')).toBe(board('Old'));
    expect(p.read('ui/b.tsx')).toBe(board('New'));
  });

  test('a cleared item stays gone: not listed, and restore is refused `cleared`', async () => {
    const p = localProject({ 'ui/b.tsx': board('B1') });
    await p.home.ready();
    await p.remove('ui/b.tsx');
    const listing = (await p.home.runtime.acceptedTrash()) as TrashListing;
    const entry = listing.canvases[0]?.entry as string;
    const c = await p.home.runtime.acceptedTrashClear();
    expect(c).toMatchObject({ status: 'accepted', cleared: [`canvas:${entry}`] });
    expect((await p.home.runtime.acceptedTrash())?.canvases).toEqual([]);
    expect(await p.home.runtime.acceptedTrashRestore(entry)).toMatchObject({
      status: 'rejected',
      code: 'cleared',
    });
    expect(existsSync(p.abs('ui/b.tsx'))).toBe(false);
  });
});
