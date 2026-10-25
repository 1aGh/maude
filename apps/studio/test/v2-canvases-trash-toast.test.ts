// S1.2 — "Move to trash" says what happened and Undo brings the canvas back (11 · pn-trash). The words are
// CONTRACT §4 ("moved to the trash", never "deleted"); the Undo goes through the Trash's own restore route
// over the folder `DELETE /_api/canvas` made, against a real server so the whole round trip is proven.

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { trashCanvas, trashFolderOf } from '../client/v2/canvases/trash-canvas.js';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

type Toast = {
  message: string;
  ok: boolean;
  action?: { label: string; onClick: () => unknown };
  extra?: { icon?: string };
};

function recorder() {
  const toasts: Toast[] = [];
  return {
    toasts,
    toast: (message: string, ok = false, action?: Toast['action'], extra?: Toast['extra']) =>
      toasts.push({ message, ok, action, extra }),
  };
}

describe('trashCanvas — the words and the refusal', () => {
  test('a refused move says so in trash words and offers no Undo', async () => {
    const rec = recorder();
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ ok: false, error: 'canvas not found' }), {
        status: 404,
      })) as unknown as typeof fetch;
    const res = await trashCanvas({
      path: '.design/ui/ahoj.tsx',
      label: 'ahoj',
      fetchImpl,
      ...rec,
    });
    expect(res.ok).toBe(false);
    expect(rec.toasts).toHaveLength(1);
    expect(rec.toasts[0].message).toBe('Could not move “ahoj” to the trash. canvas not found');
    expect(rec.toasts[0].message).not.toMatch(/delet/i);
    expect(rec.toasts[0].action).toBeUndefined();
  });

  test('a move toasts “name” moved to the trash. with one action, Undo', async () => {
    const rec = recorder();
    const reloads: number[] = [];
    const gone: string[] = [];
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ ok: true, rel: 'ui/ahoj.tsx', trashDir: '.design/_trash/x__ui-ahoj' })
      )) as unknown as typeof fetch;
    await trashCanvas({
      path: '.design/ui/ahoj.tsx',
      label: 'ahoj',
      fetchImpl,
      reload: async () => {
        reloads.push(1);
      },
      onTrashed: (p: string) => gone.push(p),
      ...rec,
    });
    expect(reloads).toHaveLength(1);
    expect(gone).toEqual(['.design/ui/ahoj.tsx']);
    expect(rec.toasts[0].message).toBe('“ahoj” moved to the trash.');
    expect(rec.toasts[0].ok).toBe(true);
    expect(rec.toasts[0].action?.label).toBe('Undo');
    // 11 pn-trash: the toast wears the trash glyph, not a check
    expect(rec.toasts[0].extra?.icon).toBe('trash');
  });

  test('trashFolderOf keeps the design-root-relative part', () => {
    expect(trashFolderOf('.design/_trash/2026-10-18T10-00-00-000Z__ui-x')).toBe(
      '_trash/2026-10-18T10-00-00-000Z__ui-x'
    );
    expect(trashFolderOf('elsewhere/x')).toBeNull();
  });
});

describe('Undo of the move-to-trash toast restores the canvas (real server)', () => {
  test('canvas, its meta and its camera file come back; the path is the old one', async () => {
    const { root, designRoot } = makeSandbox();
    const port = nextPort();
    const proc = await bootServer(root, port);
    const base = `http://localhost:${port}`;
    const fetchImpl = ((url: string, init?: RequestInit) =>
      fetch(`${base}${url}`, init)) as unknown as typeof fetch;
    try {
      const created = (await (
        await fetch(`${base}/_api/canvas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'ahoj' }),
        })
      ).json()) as { file: string; slug: string };
      mkdirSync(join(designRoot, '_canvas-state'), { recursive: true });
      const view = join(designRoot, '_canvas-state', `${created.slug}.view.json`);
      writeFileSync(view, JSON.stringify({ viewport: { x: 1, y: 2, zoom: 1 } }));
      const tsx = join(designRoot, 'ui', 'ahoj.tsx');
      const meta = join(designRoot, 'ui', 'ahoj.meta.json');
      const before = readFileSync(tsx, 'utf8');
      expect(existsSync(meta)).toBe(true);

      const rec = recorder();
      const res = await trashCanvas({ path: created.file, label: 'ahoj', fetchImpl, ...rec });
      expect(res.ok).toBe(true);
      expect(existsSync(tsx)).toBe(false);
      expect(existsSync(view)).toBe(false);

      await rec.toasts[0].action?.onClick();
      expect(existsSync(tsx)).toBe(true);
      expect(readFileSync(tsx, 'utf8')).toBe(before);
      expect(existsSync(meta)).toBe(true);
      expect(existsSync(view)).toBe(true);
      expect(rec.toasts.at(-1)?.message).toBe('“ahoj” is back.');
    } finally {
      await killProc(proc);
    }
  }, 60_000);
});
