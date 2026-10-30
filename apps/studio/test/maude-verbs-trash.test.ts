// S1.17 — `maude design trash list|restore|clear` (contract V2-1.11 §5.3 amended by S1.7/S1.17, S1-trash.md).
// list is read-only (auto tier); restore brings one item back (project → auto); clear deletes for
// good and is the OWNER's alone (decision:maude/v2-lead-trash-clear-human-only): the verb asks first
// (--yes on a script), and the studio's route refuses every other role whatever the verb sent.

import { afterEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { fakeStudio, json, type Seen } from './_fake-studio.ts';

const ITEMS = [
  {
    id: 'canvas:e1',
    kind: 'canvas',
    path: 'ui/home.tsx',
    actor: 'jonas@x.cz',
    who: 'Jonas\u001b[2J',
    mine: false,
    at: 1_760_000_000_000,
    group: 'today',
    rev: 4,
    actionId: 'a_4',
    entry: 'e1',
    doc: 'd1',
  },
  {
    id: 'artboard:a_9/hero',
    kind: 'artboard',
    path: 'ui/home.tsx',
    artboard: 'hero',
    label: 'Hero',
    who: 'Ada',
    mine: true,
    at: 1_750_000_000_000,
    group: 'earlier',
    rev: 9,
    actionId: 'a_9',
    entry: 'e2',
    doc: 'd2',
  },
];

let studio: ReturnType<typeof fakeStudio> | null = null;
afterEach(() => {
  studio?.stop();
  studio = null;
});

const listing = (s: Seen) => {
  if (s.path === '/_api/trash' && s.method === 'GET')
    return json({ ok: true, items: ITEMS, canClear: true, seq: 3 });
};
const writes = (seen: Seen[]) => seen.filter((s) => s.method !== 'GET');
const answers = (route: string, status: number, body: Record<string, unknown>) => (s: Seen) =>
  s.path === route ? json(body, status) : listing(s);

describe('maude design trash list', () => {
  test('prints each item with its id, path and who — and writes nothing', async () => {
    studio = fakeStudio(listing);
    const r = await studio.run('trash', ['list']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('canvas:e1');
    expect(r.stdout).toContain('ui/home.tsx');
    expect(r.stdout).toContain('artboard:a_9/hero');
    expect(r.stdout).toContain('Hero');
    expect(r.stdout).not.toContain('\u001b'); // a peer's name can't drive the terminal
    expect(studio.seen.map((s) => `${s.method} ${s.path}`)).toEqual(['GET /_api/trash']);
  });

  test('--json carries the items, marked untrusted', async () => {
    studio = fakeStudio(listing);
    const r = await studio.run('trash', ['list', '--json']);
    const out = JSON.parse(r.stdout);
    expect(out.untrusted).toBe(true);
    expect(out.items.map((i: { id: string }) => i.id)).toEqual(['canvas:e1', 'artboard:a_9/hero']);
    expect(out.canClear).toBe(true);
  });

  test('a project with no shared Trash says so (exit 0, no items)', async () => {
    studio = fakeStudio((s) =>
      s.path === '/_api/trash'
        ? json({ ok: true, legacy: true, items: [], canClear: false })
        : undefined
    );
    const r = await studio.run('trash', ['list']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('_trash');
  });

  test('an unreachable team server is an error, not an empty Trash', async () => {
    studio = fakeStudio((s) =>
      s.path === '/_api/trash' ? json({ ok: false, reason: 'unreachable' }) : undefined
    );
    const r = await studio.run('trash', ['list']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('unreachable');
  });
});

describe('maude design trash restore', () => {
  test('posts { id } and says where it came back', async () => {
    studio = fakeStudio(
      answers('/_api/trash/restore', 200, {
        ok: true,
        id: 'canvas:e1',
        path: 'ui/home.tsx',
        renamed: false,
      })
    );
    const r = await studio.run('trash', ['restore', 'canvas:e1']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('ui/home.tsx');
    expect(writes(studio.seen)).toEqual([
      { method: 'POST', path: '/_api/trash/restore', query: {}, body: { id: 'canvas:e1' } },
    ]);
  });

  test('a renamed restore (the path was taken) says so', async () => {
    studio = fakeStudio(
      answers('/_api/trash/restore', 200, {
        ok: true,
        id: 'canvas:e1',
        path: 'ui/home 2.tsx',
        renamed: true,
      })
    );
    const r = await studio.run('trash', ['restore', 'canvas:e1']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('home 2.tsx');
    expect(r.stdout).toContain('was taken');
  });

  test('a canvas path names the item when exactly one item in the Trash has it', async () => {
    studio = fakeStudio((s) => {
      if (s.path === '/_api/trash' && s.method === 'GET')
        return json({ ok: true, items: [ITEMS[0]], canClear: true, seq: 1 });
      if (s.path === '/_api/trash/restore') return json({ ok: true, path: 'ui/home.tsx' });
    });
    const r = await studio.run('trash', ['restore', 'ui/home.tsx']);
    expect(r.code).toBe(0);
    expect(writes(studio.seen)[0]?.body).toEqual({ id: 'canvas:e1' });
  });

  test('a path shared by two items is ambiguous: exit 2, the ids named, nothing sent', async () => {
    studio = fakeStudio(listing);
    const r = await studio.run('trash', ['restore', 'ui/home.tsx']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('canvas:e1');
    expect(writes(studio.seen)).toEqual([]);
  });

  test('refusals: cleared · taken · forbidden are one-line exit 1', async () => {
    for (const [status, reason] of [
      [409, 'cleared'],
      [409, 'taken'],
      [403, 'forbidden'],
      [501, 'not-yet'],
    ] as const) {
      studio = fakeStudio(answers('/_api/trash/restore', status, { ok: false, reason }));
      const r = await studio.run('trash', ['restore', 'canvas:e1']);
      expect({ reason, code: r.code }).toEqual({ reason, code: 1 });
      expect(r.stderr).toContain(reason);
      studio.stop();
      studio = null;
    }
  });

  test('an id that is not a Trash id is a usage error before any request', async () => {
    studio = fakeStudio(listing);
    const r = await studio.run('trash', ['restore', '../../etc/passwd']);
    expect(r.code).toBe(2);
    expect(writes(studio.seen)).toEqual([]);
  });
});

describe('maude design trash clear (owner only, asks first)', () => {
  test('without --yes and without a terminal it refuses before any request', async () => {
    studio = fakeStudio(listing);
    const r = await studio.run('trash', ['clear']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('--yes');
    expect(studio.seen).toEqual([]);
  });

  test('--yes clears everything: posts {} and reports the count', async () => {
    studio = fakeStudio(
      answers('/_api/trash/clear', 200, { ok: true, cleared: ['canvas:e1', 'artboard:a_9/hero'] })
    );
    const r = await studio.run('trash', ['clear', '--yes']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('2');
    expect(writes(studio.seen)).toEqual([
      { method: 'POST', path: '/_api/trash/clear', query: {}, body: {} },
    ]);
  });

  test('--item names what to clear (repeatable) and lists the ones left as they were', async () => {
    studio = fakeStudio(
      answers('/_api/trash/clear', 200, {
        ok: true,
        cleared: ['canvas:e1'],
        skipped: [{ id: 'artboard:a_9/hero', reason: 'not-in-trash' }],
      })
    );
    const r = await studio.run('trash', [
      'clear',
      '--yes',
      '--item',
      'canvas:e1',
      '--item',
      'artboard:a_9/hero',
    ]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('left as they were');
    expect(writes(studio.seen)[0]?.body).toEqual({
      items: ['canvas:e1', 'artboard:a_9/hero'],
    });
  });

  test('an editor is refused by the studio, not by the verb: 403 → exit 1, owner named', async () => {
    studio = fakeStudio(answers('/_api/trash/clear', 403, { ok: false, reason: 'forbidden' }));
    const r = await studio.run('trash', ['clear', '--yes']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('owner');
    // the verb sent it: the server decides (hidden ≠ refused)
    expect(writes(studio.seen)).toHaveLength(1);
  });

  test('a bad --item is a usage error before any request', async () => {
    studio = fakeStudio(listing);
    const r = await studio.run('trash', ['clear', '--yes', '--item', 'nope']);
    expect(r.code).toBe(2);
    expect(studio.seen).toEqual([]);
  });
});

describe('maude design trash — usage', () => {
  test('--help exits 0; unknown sub-verb or flag exits 2 before any request; no studio → 3', async () => {
    studio = fakeStudio(listing);
    expect((await studio.run('trash', ['--help'])).code).toBe(0);
    for (const args of [['nuke'], ['list', '--force'], ['restore'], []]) {
      const r = await studio.run('trash', args);
      expect({ args, code: r.code }).toEqual({ args, code: 2 });
    }
    expect(studio.seen).toEqual([]);
    writeFileSync(join(studio.root, '.design', '_server.json'), '{"port":1}');
    expect((await studio.run('trash', ['list'])).code).toBe(3);
  });
});

// V2-8.16 (live journey S1 turn 5) — `trash move <canvas>`: the agent's way to the row menu's "Move
// canvas to trash". It sends the SAME request the client does (client/v2/canvases/trash-canvas.js:
// DELETE /_api/canvas?file=<canvas>), so Version history records the same delete.
describe('maude design trash move', () => {
  const trashes = (s: Seen) =>
    s.path === '/_api/canvas' && s.method === 'DELETE'
      ? json({
          ok: true,
          rel: s.query.file,
          slug: 'ui-home',
          trashed: [s.query.file],
          trashDir: '.design/_trash/x__ui-home',
        })
      : undefined;

  test('sends DELETE /_api/canvas?file=<design-relative canvas> — one request, the row menu’s', async () => {
    studio = fakeStudio(trashes);
    const r = await studio.run('trash', ['move', '.design/ui/home.tsx']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('ui/home.tsx');
    expect(r.stdout).toContain('trash restore');
    expect(studio.seen.map((s) => `${s.method} ${s.path} ${s.query.file}`)).toEqual([
      'DELETE /_api/canvas ui/home.tsx',
    ]);
  });

  test('a refusal from the studio is exit 1 with its reason', async () => {
    studio = fakeStudio((s) =>
      s.path === '/_api/canvas' ? json({ ok: false, error: 'canvas not found' }, 404) : undefined
    );
    const r = await studio.run('trash', ['move', 'ui/gone.tsx']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('canvas not found');
  });

  test('not a canvas path → usage (exit 2) before any request', async () => {
    studio = fakeStudio(trashes);
    for (const args of [
      ['move'],
      ['move', 'ui/a.tsx', 'ui/b.tsx'],
      ['move', 'ui/notes.md'],
      ['move', '../x.tsx'],
      ['move', '/etc/x.tsx'],
      ['move', 'ui/a.tsx', '--force'],
    ]) {
      const r = await studio.run('trash', args);
      expect({ args, code: r.code }).toEqual({ args, code: 2 });
    }
    expect(studio.seen).toEqual([]);
  });
});
