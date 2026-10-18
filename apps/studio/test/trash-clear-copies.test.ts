// S1.7b — clear-out removes this machine's own parked copies of EXACTLY the cleared canvases
// (S1-trash.md §3 "Retention", sync/trash-clear-copies.ts), and nothing else under `_trash/`.

import { afterAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { trashAccess } from '../history/trash.ts';
import { createTrashRoutes } from '../routes/trash.ts';
import { createAcceptedLink } from '../sync/accepted-link.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';
import { removeClearedCopies } from '../sync/trash-clear-copies.ts';
import { changesTrash, clearedCanvases } from '../sync/trash-watch.ts';

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const A = 'export default () => <p>a</p>;\n';
const A_EDITED = 'export default () => <p>a, edited here, never synced</p>;\n';
const B = 'export default () => <p>b</p>;\n';

function tree(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-trash-clear-'));
  dirs.push(root);
  return root;
}

/** A `DELETE /_api/canvas` bundle, the way api.ts parks one. */
function bundle(designRoot: string, stamp: string, rel: string, body: string, kind?: string) {
  const slug = rel
    .replace(/\//g, '-')
    .replace(/\.tsx$/, '')
    .toLowerCase();
  const dir = path.join(designRoot, '_trash', `${stamp}__${slug}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, path.basename(rel)), body);
  writeFileSync(
    path.join(dir, '_trash-manifest.json'),
    JSON.stringify({ canvas: rel, slug, trashed: [rel], ...(kind ? { kind } : {}) })
  );
  return `_trash/${stamp}__${slug}`;
}

/** A teammate's delete, the way sync/tombstone-apply.ts parks one. */
function stone(designRoot: string, slug: string, ts: number, file: string, body: string) {
  const dir = path.join(designRoot, '_trash', `${slug}-deleted-${ts}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, file), body);
  return `_trash/${slug}-deleted-${ts}`;
}

const ls = (designRoot: string) => readdirSync(path.join(designRoot, '_trash')).sort();

describe('removeClearedCopies — exactly the cleared canvases', () => {
  test('removes the bundle and the tombstone copy of the cleared canvas, and nothing else', () => {
    const designRoot = path.join(tree(), '.design');
    const mine = bundle(designRoot, '2026-10-18T07-00-00-000Z', 'ui/a.tsx', A);
    const theirs = stone(designRoot, 'ui-a', 1_760_000_000_000, 'a.tsx', A);
    // Everything below must survive.
    const edited = stone(designRoot, 'ui-a', 1_760_000_000_001, 'a.tsx', A_EDITED);
    const other = bundle(designRoot, '2026-10-18T07-00-01-000Z', 'ui/b.tsx', B);
    const sameBytesOtherPath = bundle(designRoot, '2026-10-18T07-00-02-000Z', 'ui/c.tsx', A);
    const artboard = bundle(designRoot, '2026-10-18T07-00-03-000Z', 'ui/a.tsx', A, 'artboard');
    mkdirSync(path.join(designRoot, '_trash', '2026-10-18T07-00-04-000Z__moved-ui-a'));
    writeFileSync(
      path.join(designRoot, '_trash', '2026-10-18T07-00-04-000Z__moved-ui-a', 'a.tsx'),
      A
    );
    writeFileSync(path.join(designRoot, '_trash', 'a.tsx-conflict-1760000000000'), A);
    mkdirSync(path.join(designRoot, '_trash', '2026-10-18T07-00-05-000Z', 'ui'), {
      recursive: true,
    });
    writeFileSync(path.join(designRoot, '_trash', '2026-10-18T07-00-05-000Z', 'ui', 'a.tsx'), A);
    const before = ls(designRoot);

    const removed = removeClearedCopies({
      designRoot,
      designRel: '.design',
      cleared: [{ path: 'ui/a.tsx', body: A }],
    });

    expect(removed.sort()).toEqual([mine, theirs].sort());
    expect(ls(designRoot)).toEqual(
      before.filter((n) => ![mine, theirs].includes(`_trash/${n}`)).sort()
    );
    for (const kept of [edited, other, sameBytesOtherPath, artboard])
      expect(existsSync(path.join(designRoot, kept))).toBe(true);
  });

  test('a copy identical to an item still in the Trash at the same path stays', () => {
    const designRoot = path.join(tree(), '.design');
    const copy = stone(designRoot, 'ui-a', 1_760_000_000_000, 'a.tsx', A);
    expect(
      removeClearedCopies({
        designRoot,
        designRel: '.design',
        cleared: [{ path: 'ui/a.tsx', body: A }],
        remaining: [{ path: 'ui/a.tsx', body: A }],
      })
    ).toEqual([]);
    expect(existsSync(path.join(designRoot, copy))).toBe(true);
  });

  test('never follows a symlinked _trash/ or entry, and an empty body proves nothing', () => {
    const root = tree();
    const designRoot = path.join(root, '.design');
    mkdirSync(designRoot, { recursive: true });
    const outside = path.join(root, 'outside');
    mkdirSync(path.join(outside, 'ui-a-deleted-1760000000000'), { recursive: true });
    writeFileSync(path.join(outside, 'ui-a-deleted-1760000000000', 'a.tsx'), A);
    symlinkSync(outside, path.join(designRoot, '_trash'));
    expect(
      removeClearedCopies({
        designRoot,
        designRel: '.design',
        cleared: [{ path: 'ui/a.tsx', body: A }],
      })
    ).toEqual([]);
    expect(existsSync(path.join(outside, 'ui-a-deleted-1760000000000', 'a.tsx'))).toBe(true);

    unlinkSync(path.join(designRoot, '_trash'));
    mkdirSync(path.join(designRoot, '_trash'));
    symlinkSync(
      path.join(outside, 'ui-a-deleted-1760000000000'),
      path.join(designRoot, '_trash', 'ui-a-deleted-1760000000001')
    );
    const empty = stone(designRoot, 'ui-a', 1_760_000_000_002, 'a.tsx', '');
    expect(
      removeClearedCopies({
        designRoot,
        designRel: '.design',
        cleared: [
          { path: 'ui/a.tsx', body: A },
          { path: 'ui/a.tsx', body: '' },
        ],
      })
    ).toEqual([]);
    expect(existsSync(path.join(outside, 'ui-a-deleted-1760000000000', 'a.tsx'))).toBe(true);
    expect(existsSync(path.join(designRoot, empty))).toBe(true);
  });
});

describe('the trash watch reads the log', () => {
  test('changesTrash: deletes, trash, restore, clear-out and a revive — not an edit or a create', () => {
    const fx = (lane: string, op: string) => ({
      doc: 'd',
      lane,
      op,
      beforePath: null,
      afterPath: null,
    });
    expect(changesTrash({ kind: 'canvas.delete', effects: [fx('@manifest', 'delete')] })).toBe(
      true
    );
    expect(changesTrash({ kind: 'trash', effects: [fx('html', 'replace')] })).toBe(true);
    expect(changesTrash({ kind: 'restore', effects: [] })).toBe(true);
    expect(changesTrash({ kind: 'trash.clear', effects: [] })).toBe(true);
    expect(changesTrash({ kind: 'undo', effects: [fx('@manifest', 'create')] })).toBe(true);
    expect(changesTrash({ kind: 'edit', effects: [fx('html', 'replace')] })).toBe(false);
    expect(changesTrash({ kind: 'canvas.create', effects: [fx('@manifest', 'create')] })).toBe(
      false
    );
  });

  test('clearedCanvases: the canvas items of a clear-out, never its artboards', () => {
    const effects = [
      {
        doc: 'ui-a',
        entry: 'n_a',
        lane: '@trash',
        op: 'trash.clear',
        beforePath: 'ui/a.tsx',
        afterPath: null,
      },
      {
        doc: 'ui-c',
        entry: 'n_c',
        lane: '@trash',
        op: 'trash.clear',
        beforePath: 'ui/c.tsx',
        afterPath: null,
      },
    ];
    const origin = {
      cleared: [
        { entry: 'n_a', artboard: '', rev: 7 },
        { entry: 'n_c', artboard: 'Hero', rev: 5 },
      ],
    };
    expect(clearedCanvases({ kind: 'trash.clear', origin, effects })).toEqual([
      { entry: 'n_a', doc: 'ui-a', path: 'ui/a.tsx', rev: 7 },
    ]);
    expect(clearedCanvases({ kind: 'edit', origin, effects })).toEqual([]);
  });
});

describe('an older hub: the linked Trash answers null, the view falls back', () => {
  test('trashOps is true only when the bootstrap lists trash.restore AND trash.clear', async () => {
    const designRoot = path.join(tree(), '.design');
    mkdirSync(designRoot, { recursive: true });
    const linkWith = (operations: string[] | undefined) =>
      createAcceptedLink({
        hubUrl: 'http://127.0.0.1:1',
        token: () => 't',
        designRoot,
        docNameFor: (s) => s,
        log: { log() {}, warn() {}, error() {} },
        client: {
          bootstrap: async () => ({
            projectId: 'p',
            mode: 'transactions',
            epoch: 1,
            revision: 1,
            docs: [],
            dirs: [],
            ...(operations ? { capabilities: { operations } } : {}),
          }),
          newTransactionId: () => 'tx',
          stop() {},
        } as never,
      });
    for (const [ops, want] of [
      [undefined, false],
      [['lane.replace', 'doc.delete', 'history.undo'], false],
      [['trash.restore'], false],
      [['lane.replace', 'trash.restore', 'trash.clear'], true],
    ] as const) {
      const link = linkWith(ops ? [...ops] : undefined);
      expect(link.trashOps()).toBe(false); // nothing asked yet
      await link.refresh();
      expect(link.trashOps()).toBe(want);
    }
  });
});

describe('the local home: clear-out removes this Mac’s copies; deletes refresh the Trash', () => {
  test('owner clears out one canvas: its bundle goes, the other canvas’s and the rest stay', async () => {
    const root = tree();
    const designRoot = path.join(root, '.design');
    mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
    writeFileSync(path.join(designRoot, 'ui', 'a.tsx'), A);
    writeFileSync(path.join(designRoot, 'ui', 'b.tsx'), B);
    const emitted: [string, unknown][] = [];
    const home = openLocalHome({
      designRoot,
      designRel: '.design',
      canvasGroups: () => [{ path: 'ui' }],
      machine: { id: 'm_clear', name: 'Mac' },
      bootId: 'boot-clear',
      lockRetryMs: 0,
      settleMs: 5,
      log: { warn() {}, error() {} },
      emit: (e, p) => emitted.push([e, p]),
    });
    homes.push(home);
    await home.ready();
    // `DELETE /_api/canvas` parks each canvas, then the watcher sees it gone.
    const aCopy = bundle(designRoot, '2026-10-18T08-00-00-000Z', 'ui/a.tsx', A);
    const bCopy = bundle(designRoot, '2026-10-18T08-00-01-000Z', 'ui/b.tsx', B);
    writeFileSync(path.join(designRoot, '_trash', 'notes.txt'), 'mine');
    for (const rel of ['ui/a.tsx', 'ui/b.tsx']) {
      unlinkSync(path.join(designRoot, rel));
      home.observe(rel);
    }
    await home.flush();
    // live refresh: an accepted delete says so on the bus
    expect(emitted.some(([e]) => e === 'trash:changed')).toBe(true);

    const specs = createTrashRoutes({
      control: () => home.runtime,
      access: () => trashAccess({ workspace: false, header: null, localRole: 'owner' }),
      readSource: () => null,
    });
    const get = specs.find((s) => s.method === 'GET') as (typeof specs)[number];
    const clear = specs.find((s) => s.path === '/_api/trash/clear') as (typeof specs)[number];
    const items = (await (await get.handle(new Request('http://x/_api/trash'), {})).json())
      .items as {
      id: string;
      path: string;
    }[];
    const a = items.find((i) => i.path === 'ui/a.tsx');
    expect(a).toBeTruthy();
    const res = await clear.handle(
      new Request('http://x/_api/trash/clear', {
        method: 'POST',
        body: JSON.stringify({ items: [a?.id] }),
      }),
      {}
    );
    expect(res.status).toBe(200);
    expect(existsSync(path.join(designRoot, aCopy))).toBe(false);
    expect(existsSync(path.join(designRoot, bCopy))).toBe(true);
    expect(existsSync(path.join(designRoot, '_trash', 'notes.txt'))).toBe(true);
  });
});
