// S3.1 · T11 (V2-1.2 §5.4 "A8 hold", Gate 0 A8) — the canvas document's HMR applier holds a write
// to THIS canvas while the shell says Present · Artboards, keeps only the newest, and lands it when
// the presenter moves on (`present-position` changes) or leaves Present. Preview and Present ·
// Canvas apply at once (AI changes show live, under the pointer too).
//
// Runs the template's own code (lifted between its `module-update` and `present-hold` markers) in a
// happy-dom document, with the soft reload and the page reload stubbed. The release is driven by the
// real reporter the Present stage calls (bridge/canvas-mode-store.ts `reportPresentPosition`).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { reportPresentPosition } from '../bridge/canvas-mode-store.ts';
import { holdsModuleUpdates } from '../bridge/canvas-modes.ts';

const SHELL = readFileSync(
  join(import.meta.dir, '..', '..', '..', 'plugins', 'design', 'templates', '_shell.html'),
  'utf8'
);

function region(name: string): string {
  const begin = SHELL.indexOf(`// ${name}:begin`);
  const end = SHELL.indexOf(`// ${name}:end`);
  expect(begin).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(begin);
  return SHELL.slice(begin, end);
}

const CANVAS = 'ui/Campaign.tsx';

function liftApplier() {
  const shellWin = { name: 'the studio shell' };
  const listeners: Array<(e: { source: unknown; data: unknown }) => void> = [];
  const soft: Array<string | number | undefined> = [];
  const reloads: number[] = [];
  const patched: unknown[] = [];
  const doc = document.implementation.createHTMLDocument('canvas');
  const win = {
    parent: shellWin,
    addEventListener: (type: string, fn: (e: { source: unknown; data: unknown }) => void) => {
      if (type === 'message') listeners.push(fn);
    },
    __maudeCanvasRuntime: { remount: () => {} },
  };
  const make = new Function(
    'window',
    'document',
    'location',
    'canvasRel',
    'softReload',
    'applyTextPatches',
    'lastCssOptimisticAt',
    `${region('module-update')}\n${region('present-hold')}\nreturn { routeModuleUpdate, holdsModuleUpdates };`
  );
  const api = make(
    win,
    doc,
    { reload: () => reloads.push(1) },
    CANVAS,
    (v: string | number | undefined) => soft.push(v),
    (p: unknown) => patched.push(p),
    0
  ) as {
    routeModuleUpdate: (m: Record<string, unknown>) => void;
    holdsModuleUpdates: (s: unknown) => boolean;
  };
  let seq = 0;
  const post = (source: unknown, data: unknown) => {
    for (const fn of listeners) fn({ source, data });
  };
  const setMode = (mode: string, present: unknown = null, from: unknown = shellWin) =>
    post(from, {
      dgn: 'set-mode',
      v: 2,
      seq: ++seq,
      mode,
      present,
      caps: { edit: true, annotate: true, comment: true },
    });
  const posted: unknown[] = [];
  const canvasWin = {
    document: doc,
    CustomEvent: window.CustomEvent,
    parent: { postMessage: (m: unknown) => posted.push(m) },
  } as unknown as Window;
  const moveOn = (index: number, artboardId: string) =>
    reportPresentPosition(canvasWin, { index, total: 14, artboardId });
  const write = (version: number, extra: Record<string, unknown> = {}) =>
    api.routeModuleUpdate({ type: 'canvas-hmr', mode: 'module', file: CANVAS, version, ...extra });
  return { api, soft, reloads, patched, setMode, moveOn, write, post, posted, win, shellWin };
}

const ARTBOARDS = { kind: 'artboards', from: 'post-1x1' };

describe('A8 — Present · Artboards holds a canvas write until the presenter moves on', () => {
  test('Preview: a write lands at once (live, under the pointer too)', () => {
    const t = liftApplier();
    t.setMode('preview');
    t.write(1);
    expect(t.soft).toEqual([1]);
  });

  test('Present · Canvas: a write lands at once', () => {
    const t = liftApplier();
    t.setMode('present', { kind: 'canvas' });
    t.write(1);
    expect(t.soft).toEqual([1]);
  });

  test('held while presenting artboards; only the newest is kept; a move lands it once', () => {
    const t = liftApplier();
    t.setMode('present', ARTBOARDS);
    t.moveOn(0, 'post-1x1'); // the stage reports where it starts
    t.write(1, { patches: [{ id: 'aaaaaaaa', text: 'old' }] });
    t.write(2, { patches: [{ id: 'aaaaaaaa', text: 'new' }] });
    expect(t.soft).toEqual([]);
    expect(t.patched).toEqual([]); // no text patch reaches the screen either
    t.moveOn(0, 'post-1x1'); // the same position again: still held
    expect(t.soft).toEqual([]);
    t.moveOn(1, 'story-9x16');
    expect(t.soft).toEqual([2]);
    expect(t.patched).toEqual([[{ id: 'aaaaaaaa', text: 'new' }]]);
    // the shell heard the same move (the counter, presenter view)
    expect(t.posted.at(-1)).toEqual({
      dgn: 'present-position',
      index: 1,
      total: 14,
      artboardId: 'story-9x16',
    });
    t.moveOn(2, 'banner'); // nothing held: nothing to land
    expect(t.soft).toEqual([2]);
  });

  test('leaving Present lands the held write', () => {
    const t = liftApplier();
    t.setMode('present', ARTBOARDS);
    t.write(7);
    expect(t.soft).toEqual([]);
    t.setMode('edit');
    expect(t.soft).toEqual([7]);
    t.write(8); // back in Edit: live again
    expect(t.soft).toEqual([7, 8]);
  });

  test('a held `hard` change stays a full reload even when a module write follows it', () => {
    const t = liftApplier();
    t.setMode('present', ARTBOARDS);
    t.api.routeModuleUpdate({ type: 'canvas-hmr', mode: 'hard', version: 3 });
    t.write(4);
    t.moveOn(1, 'story-9x16');
    expect(t.soft).toEqual([]);
    expect(t.reloads).toEqual([1]);
  });

  test('another canvas’s write is neither held nor applied here', () => {
    const t = liftApplier();
    t.setMode('present', ARTBOARDS);
    t.api.routeModuleUpdate({
      type: 'canvas-hmr',
      mode: 'module',
      file: 'ui/Other.tsx',
      version: 5,
    });
    t.setMode('edit');
    expect(t.soft).toEqual([]);
  });

  test('only the shell can start a hold: a canvas self-post of set-mode, or a stale seq, is ignored', () => {
    const t = liftApplier();
    // the canvas module shares this realm and can post to itself — it must not hold its own updates
    t.post(t.win, {
      dgn: 'set-mode',
      v: 2,
      seq: 99,
      mode: 'present',
      present: ARTBOARDS,
      caps: { edit: true, annotate: true, comment: true },
    });
    t.write(1);
    expect(t.soft).toEqual([1]);
    t.setMode('present', ARTBOARDS); // seq 1
    t.post(t.shellWin, {
      dgn: 'set-mode',
      v: 2,
      seq: 1, // a repeated (older) seq does not end the hold
      mode: 'edit',
      present: null,
      caps: { edit: true, annotate: true, comment: true },
    });
    t.write(2);
    expect(t.soft).toEqual([1]);
  });
});

test('the template’s inline predicate is canvas-modes.ts `holdsModuleUpdates` (parity)', () => {
  const t = liftApplier();
  const snaps = [
    null,
    { mode: 'present', present: { kind: 'artboards' } },
    { mode: 'present', present: { kind: 'artboards', from: 'start' } },
    { mode: 'present', present: { kind: 'canvas' } },
    { mode: 'present', present: null },
    { mode: 'preview', present: { kind: 'artboards' } },
    { mode: 'edit', present: null },
    { mode: 'viewing', present: null },
    { mode: null, present: null },
  ];
  for (const s of snaps)
    expect(t.api.holdsModuleUpdates(s)).toBe(
      holdsModuleUpdates(s as Parameters<typeof holdsModuleUpdates>[0])
    );
  expect(holdsModuleUpdates({ mode: 'present', present: { kind: 'artboards' } })).toBe(true);
  expect(holdsModuleUpdates({ mode: 'preview', present: null })).toBe(false);
});
