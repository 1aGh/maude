// S9.11 — V2-1.16 L12: studio WebSocket broadcasts.
//
// Booted cell: a scripted owner session edits B's source, adds a B comment, starts AI work
// on B, creates a B-named canvas and deletes it. An A-only inspector socket and an A-only
// canvas-hmr socket receive NO frame mentioning B (the canary sweep over the wire, U2) —
// while the owner's sockets hear all of it (the activity happened) and the A-only sockets
// still hear about A. Plus the frame table: every class, unit-level.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { frameFor, type Seer, snapshotFor, WS_FRAME_CLASSES } from '../access/filters.ts';
import {
  A_ONLY,
  A_REL,
  A_SRC,
  type AclCell,
  B_REL,
  bootAclCell,
  hasCanary,
  type Listener,
  listen,
  OWNER,
  until,
} from './_acl-cell.ts';
import { killProc } from './_helpers.ts';

const B_FILE = `.design/${B_REL}`;

describe('the canary sweep over the sockets (booted cell)', () => {
  let cell: AclCell;
  const socks: Record<string, Listener> = {};
  beforeAll(async () => {
    cell = await bootAclCell();
    const ws = cell.base.replace(/^http/, 'ws');
    const wsCanvas = cell.canvasBase.replace(/^http/, 'ws');
    const open = async (name: string, url: string, headers: Record<string, string>) => {
      const l = await listen(url, headers);
      if ('refused' in l) throw new Error(`${name} socket refused`);
      socks[name] = l;
    };
    await open('ownerShell', `${ws}/_ws`, OWNER);
    await open('ownerHmr', `${wsCanvas}/_ws`, OWNER);
    await open('aShell', `${ws}/_ws`, A_ONLY);
    await open('aHmr', `${wsCanvas}/_ws`, A_ONLY);
    await Bun.sleep(300);

    // ── the scripted B activity ────────────────────────────────────────────────────────
    const send = (path: string, method: string, body?: unknown) =>
      fetch(cell.base + path, {
        method,
        headers: { 'content-type': 'application/json', origin: cell.base, ...OWNER },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    writeFileSync(
      join(cell.designRoot, B_REL),
      '// CANARY-B-SOURCE edited\nexport default () => null;\n'
    );
    socks.ownerShell?.ws.send(
      JSON.stringify({
        type: 'comments-add',
        payload: { file: B_FILE, selector: 'img', text: 'CANARY-B-COMMENT' },
      })
    );
    await send('/_api/ai/start', 'POST', { file: B_FILE, author: 'Claude' });
    await send('/_api/canvas', 'POST', { name: 'canary-b-two', group: 'ui' });
    await send(`/_api/canvas?file=${encodeURIComponent('.design/ui/canary-b-two.tsx')}`, 'DELETE');
    // …and one A change the A-only sockets MUST hear
    writeFileSync(join(cell.designRoot, A_REL), `${A_SRC}// edited\n`);

    await until(
      () =>
        (socks.ownerShell?.frames.filter(hasCanary).length ?? 0) >= 3 &&
        (socks.ownerHmr?.frames.some(hasCanary) ?? false) &&
        (socks.aHmr?.frames.some((f) => f.includes('ui/a.tsx')) ?? false),
      10000
    );
    await Bun.sleep(1500); // let every trailing debounce land
  }, 60000);
  afterAll(async () => {
    for (const s of Object.values(socks)) s.close();
    if (cell) await killProc(cell.proc);
  });

  test('the owner heard the B activity (the sweep is not vacuous)', () => {
    const shell = socks.ownerShell?.frames.filter(hasCanary).map((f) => JSON.parse(f).type);
    expect(shell).toEqual(
      expect.arrayContaining(['comments', 'ai-activity', 'canvas-list-update'])
    );
    expect(socks.ownerHmr?.frames.some(hasCanary)).toBe(true);
  });

  test('the A-only shell socket received no frame mentioning B', () => {
    expect(socks.aShell?.frames.filter(hasCanary)).toEqual([]);
  });

  test('the A-only canvas-hmr socket received no frame mentioning B', () => {
    expect(socks.aHmr?.frames.filter(hasCanary)).toEqual([]);
  });

  test('the A-only sockets still hear about A', () => {
    expect(socks.aHmr?.frames.some((f) => f.includes('ui/a.tsx'))).toBe(true);
    expect(socks.aShell?.frames.some((f) => f.includes('ui/a.tsx'))).toBe(true);
  });

  test('an A-only socket asking for B comments gets nothing back', async () => {
    const before = socks.aShell?.frames.length ?? 0;
    socks.aShell?.ws.send(JSON.stringify({ type: 'comments-request', file: B_FILE }));
    await Bun.sleep(500);
    expect(socks.aShell?.frames.slice(before).filter(hasCanary)).toEqual([]);
    expect(socks.aShell?.frames.slice(before).some((f) => f.includes('"comments"'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The frame table (U3) — unit.

const D = '.design';
const seeA: Seer = Object.assign((rel: string) => rel === 'ui/a.tsx' || rel === 'ui/a.css', {
  holds: (dir: string) => 'ui/a.tsx'.startsWith(`${dir}/`),
});

describe('frameFor', () => {
  test('a project session (null seer) gets every frame byte-identical (U7)', () => {
    for (const type of Object.keys(WS_FRAME_CLASSES)) {
      const f = { type, file: 'ui/canary-b-zx.tsx', payload: { rel: 'ui/canary-b-zx.tsx' } };
      expect(frameFor(f, null, D)).toBe(f);
    }
    const unknown = { type: 'something-new', file: 'ui/canary-b-zx.tsx' };
    expect(frameFor(unknown, null, D)).toBe(unknown);
  });

  test('canvas-class frames pass for A and drop for B, in both path spellings', () => {
    for (const type of ['fs:html', 'fs:css', 'fs:json', 'comments', 'ai-activity', 'activity']) {
      expect(frameFor({ type, file: '.design/ui/a.tsx' }, seeA, D)).not.toBeNull();
      expect(frameFor({ type, file: 'ui/a.tsx' }, seeA, D)).not.toBeNull();
      expect(frameFor({ type, file: '.design/ui/canary-b-zx.tsx' }, seeA, D)).toBeNull();
    }
  });

  test('project-class frames and unknown types never reach a canvas-only socket', () => {
    for (const type of ['git-status', 'sync:status', 'git-lifecycle', 'thumb-ready', 'ai:runs'])
      expect(frameFor({ type, payload: {} }, seeA, D)).toBeNull();
    expect(frameFor({ type: 'something-new' }, seeA, D)).toBeNull();
    expect(frameFor({ type: 'config-updated' }, seeA, D)).toEqual({ type: 'config-updated' });
  });

  test('canvas-hmr: a lib reload passes; B and its text patches drop', () => {
    expect(frameFor({ type: 'canvas-hmr', mode: 'hard', scope: 'lib' }, seeA, D)).not.toBeNull();
    const b = { type: 'canvas-hmr', mode: 'module', file: 'ui/canary-b-zx.tsx', patches: ['x'] };
    expect(frameFor(b, seeA, D)).toBeNull();
    expect(frameFor({ ...b, file: 'ui/a.css' }, seeA, D)).not.toBeNull();
  });

  test('canvas-list-update: a move across the boundary is an add or a removal', () => {
    const moved = (rel: string, fromRel: string) => ({
      type: 'canvas-list-update',
      payload: { action: 'moved', rel, slug: 's', fromRel, fromSlug: 'f' },
    });
    expect(frameFor(moved('ui/canary-b-zx.tsx', 'ui/old-b.tsx'), seeA, D)).toBeNull();
    expect(frameFor(moved('ui/a.tsx', 'ui/canary-b-zx.tsx'), seeA, D)).toEqual({
      type: 'canvas-list-update',
      payload: { action: 'added', rel: 'ui/a.tsx', slug: 's' },
    });
    expect(frameFor(moved('ui/canary-b-zx.tsx', 'ui/a.tsx'), seeA, D)).toEqual({
      type: 'canvas-list-update',
      payload: { action: 'removed', rel: 'ui/a.tsx', slug: 'f' },
    });
    const folder = (dir: string) => ({
      type: 'canvas-list-update',
      payload: { action: 'removed-folder', dir },
    });
    expect(frameFor(folder('canary-b'), seeA, D)).toBeNull();
    expect(frameFor(folder('ui'), seeA, D)).not.toBeNull();
  });

  test('project:action is relabelled from the visible canvases (U4); none visible → dropped', () => {
    const action = (canvases: string[]) => ({
      type: 'project:action',
      action: {
        label: 'Claude edited canary-b-zx and a',
        canvases,
        artboards: Object.fromEntries(canvases.map((c) => [c, ['ab1']])),
      },
    });
    expect(frameFor(action(['ui/canary-b-zx.tsx']), seeA, D)).toBeNull();
    const mixed = frameFor(action(['ui/a.tsx', 'ui/canary-b-zx.tsx']), seeA, D);
    expect(hasCanary(JSON.stringify(mixed))).toBe(false);
    expect((mixed?.action as { label?: string } | undefined)?.label).toBe('Changed a');
    const whole = action(['ui/a.tsx']);
    expect(frameFor(whole, seeA, D)).toBe(whole);
  });

  test('index-changed keeps only visible rels; export:job only when addressed to the owner', () => {
    expect(
      frameFor({ type: 'index-changed', seq: 3, rels: ['ui/a.tsx', 'ui/canary-b-zx.tsx'] }, seeA, D)
    ).toEqual({ type: 'index-changed', seq: 3, rels: ['ui/a.tsx'] });
    expect(
      frameFor({ type: 'index-changed', seq: 4, rels: ['ui/canary-b-zx.tsx'] }, seeA, D)
    ).toBeNull();
    const job = { type: 'export:job', payload: { id: 'j' } };
    expect(frameFor(job, seeA, D)).toBeNull();
    expect(frameFor(job, seeA, D, { addressed: true })).toBe(job);
  });

  test('the open snapshot keeps only visible tabs, selection and activity', () => {
    const snap = snapshotFor(
      {
        type: 'snapshot',
        state: {
          active: '.design/ui/canary-b-zx.tsx',
          open_tabs: ['.design/ui/a.tsx', '.design/ui/canary-b-zx.tsx'],
          selected: [{ file: '.design/ui/canary-b-zx.tsx' }, { file: '.design/ui/a.tsx' }],
          selections: { 'ui-canary-b-zx': { file: '.design/ui/canary-b-zx.tsx' } },
        },
        activity: { 'ui/canary-b-zx.tsx': { status: 'active' }, 'ui/a.tsx': { status: 'idle' } },
      },
      seeA,
      D
    );
    expect(hasCanary(JSON.stringify(snap))).toBe(false);
    expect((snap.state as { open_tabs: string[] }).open_tabs).toEqual(['.design/ui/a.tsx']);
    expect(Object.keys(snap.activity as object)).toEqual(['ui/a.tsx']);
  });
});
