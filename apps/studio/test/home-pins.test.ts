// V2-3.3 — `/_home/pins` (V2-1.1 §5.3/§5.5): Home pins a canvas of a project whose server is not
// running, writing only `<root>/.design/_canvas-state/_pins.json`, and only when the snapshot's root
// still IS that pid. Plus the project server's own `/_api/pins` route and the index merge.

import { beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readPins, stampRecent } from '../home/user-state.ts';
import { readSnapshot, snapshotPath } from '../index/snapshot.ts';
import { createPinsRoutes } from '../routes/pins.ts';
import { freshIndexDir, homeFetch, homeReq, makeProject } from './_home-fixtures.ts';

const pin = (body: unknown) =>
  homeReq('/_home/pins', { method: 'POST', body: JSON.stringify(body) });

beforeEach(() => {
  freshIndexDir();
});

describe('/_home/pins', () => {
  test('writes the project’s _canvas-state/_pins.json and nothing else', async () => {
    const a = makeProject('alpha', { 'ui/One.tsx': 'One', 'ui/Two.tsx': 'Two' });
    const f = homeFetch();
    const r = await f(pin({ pid: a.pid, canvas: 'ui/One.tsx', pinned: true }));
    expect(r.status).toBe(200);
    const file = join(a.designRoot, '_canvas-state', '_pins.json');
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    expect(onDisk.v).toBe(1);
    expect(onDisk.pins.map((p: { canvas: string }) => p.canvas)).toEqual(['ui/One.tsx']);

    // unpin: same file, emptied
    expect((await f(pin({ pid: a.pid, canvas: 'ui/One.tsx', pinned: false }))).status).toBe(200);
    expect(readPins(a.designRoot).pins).toEqual([]);
  });

  test('a snapshot whose root resolves to ANOTHER pid is refused, and nothing is written there', async () => {
    const a = makeProject('alpha', { 'ui/One.tsx': 'One' });
    const b = makeProject('beta', { 'ui/One.tsx': 'One' });
    // plant: A's snapshot now names B's folder as its root
    const snap = readSnapshot(a.pid);
    if (!snap) throw new Error('no snapshot');
    snap.project.root = b.root;
    writeFileSync(snapshotPath(a.pid), JSON.stringify(snap));

    const r = await homeFetch()(pin({ pid: a.pid, canvas: 'ui/One.tsx', pinned: true }));
    expect(r.status).toBe(403);
    expect(existsSync(join(b.designRoot, '_canvas-state', '_pins.json'))).toBe(false);
    expect(existsSync(join(a.designRoot, '_canvas-state', '_pins.json'))).toBe(false);
  });

  test('a moved project folder (root gone) is not written', async () => {
    const a = makeProject('alpha', { 'ui/One.tsx': 'One' });
    renameSync(a.root, `${a.root}-moved`);
    const r = await homeFetch()(pin({ pid: a.pid, canvas: 'ui/One.tsx', pinned: true }));
    expect(r.status).toBe(404);
    expect(existsSync(join(`${a.root}-moved`, '.design', '_canvas-state', '_pins.json'))).toBe(
      false
    );
  });

  // V2-3.10 W5 — a design dir (or any parent of it inside the project) that is a symlink is
  // neither read nor written through; the same for `_canvas-state` itself (L8).
  test('a symlinked design root or parent is refused: no rows read, no pin written', async () => {
    const f = homeFetch();
    const outside = mkdtempSync(join(tmpdir(), 'maude-w5-outside-'));

    // (1) `.design -> /elsewhere`
    const a = makeProject('alpha', { 'ui/One.tsx': 'One' });
    renameSync(a.designRoot, join(outside, 'a-design'));
    symlinkSync(join(outside, 'a-design'), a.designRoot);
    expect((await f(pin({ pid: a.pid, canvas: 'ui/One.tsx', pinned: true }))).status).toBe(403);
    expect(existsSync(join(outside, 'a-design', '_canvas-state', '_pins.json'))).toBe(false);
    const idx = (await (await f(homeReq(`/_home/index?pids=${a.pid}`))).json()) as {
      projects: Array<{ state: string; canvases: unknown[] }>;
    };
    expect(idx.projects[0]?.state).not.toBe('ok');
    expect(idx.projects[0]?.canvases ?? []).toEqual([]);

    // (2) a PARENT of the design dir: designRel `link/.design`, `link -> /elsewhere`
    const b = makeProject('beta', { 'ui/One.tsx': 'One' });
    mkdirSync(join(outside, 'b-parent'));
    renameSync(b.designRoot, join(outside, 'b-parent', '.design'));
    symlinkSync(join(outside, 'b-parent'), join(b.root, 'link'));
    const snap = readSnapshot(b.pid);
    if (!snap) throw new Error('no snapshot');
    snap.project.designRel = 'link/.design';
    writeFileSync(snapshotPath(b.pid), JSON.stringify(snap));
    expect((await f(pin({ pid: b.pid, canvas: 'ui/One.tsx', pinned: true }))).status).toBe(403);
    expect(existsSync(join(outside, 'b-parent', '.design', '_canvas-state', '_pins.json'))).toBe(
      false
    );

    // (3) L8: the design dir is real but `_canvas-state -> /elsewhere`
    const c = makeProject('gamma', { 'ui/One.tsx': 'One' });
    mkdirSync(join(outside, 'c-state'));
    symlinkSync(join(outside, 'c-state'), join(c.designRoot, '_canvas-state'));
    expect((await f(pin({ pid: c.pid, canvas: 'ui/One.tsx', pinned: true }))).status).not.toBe(200);
    expect(existsSync(join(outside, 'c-state', '_pins.json'))).toBe(false);
  });

  test('refuses a bad pid, a traversal key, a missing canvas', async () => {
    const a = makeProject('alpha', { 'ui/One.tsx': 'One' });
    const f = homeFetch();
    for (const body of [
      { pid: 'nope', canvas: 'ui/One.tsx', pinned: true },
      { pid: a.pid, canvas: '../../etc/passwd.tsx', pinned: true },
      { pid: a.pid, canvas: 'ui/_canvas-state/x.tsx', pinned: true },
      { pid: a.pid, canvas: 'ui/One.tsx', pinned: 'yes' },
    ])
      expect((await f(pin(body))).status).toBe(400);
    expect((await f(pin({ pid: a.pid, canvas: 'ui/Ghost.tsx', pinned: true }))).status).toBe(404);
    expect(
      (await f(pin({ pid: 'l0000000000000000', canvas: 'ui/One.tsx', pinned: true }))).status
    ).toBe(404);
  });

  test('/_home/index merges pins and last-opened from _canvas-state', async () => {
    const a = makeProject('alpha', { 'ui/One.tsx': 'One', 'ui/Two.tsx': 'Two' });
    const f = homeFetch();
    await f(pin({ pid: a.pid, canvas: 'ui/Two.tsx', pinned: true }));
    stampRecent(a.designRoot, 'ui/One.tsx', 1760001000000);
    const r = await f(homeReq(`/_home/index?pids=${a.pid}`));
    const body = (await r.json()) as {
      projects: Array<{
        state: string;
        stale: boolean;
        canvases: Array<{ rel: string; pinnedAt: number | null; openedAt: number | null }>;
      }>;
    };
    const p = body.projects[0];
    expect(p?.state).toBe('ok');
    expect(p?.stale).toBe(false);
    const by = Object.fromEntries((p?.canvases ?? []).map((c) => [c.rel, c]));
    expect(by['ui/Two.tsx']?.pinnedAt).toBeGreaterThan(0);
    expect(by['ui/One.tsx']?.pinnedAt).toBeNull();
    expect(by['ui/One.tsx']?.openedAt).toBe(1760001000000);
  });

  test('a closed project edited while nothing ran is rebuilt on read', async () => {
    const a = makeProject('alpha', { 'ui/One.tsx': 'One' });
    writeFileSync(
      join(a.designRoot, 'ui', 'Three.tsx'),
      'export default function T(){return null}'
    );
    const f = homeFetch();
    const closed = (await (await f(homeReq(`/_home/index?pids=${a.pid}`))).json()) as {
      projects: Array<{ stale: boolean; rebuilt?: boolean; canvases: Array<{ rel: string }> }>;
    };
    expect(closed.projects[0]?.rebuilt).toBe(true);
    expect(closed.projects[0]?.canvases.map((c) => c.rel)).toContain('ui/Three.tsx');

    // a RUNNING project's server writes its own: Home serves the old rows flagged stale
    writeFileSync(join(a.designRoot, 'ui', 'Four.tsx'), 'export default function F(){return null}');
    const running = (await (
      await f(homeReq(`/_home/index?pids=${a.pid}&running=${a.pid}`))
    ).json()) as {
      projects: Array<{ stale: boolean; canvases: Array<{ rel: string }> }>;
    };
    expect(running.projects[0]?.stale).toBe(true);
    expect(running.projects[0]?.canvases.map((c) => c.rel)).not.toContain('ui/Four.tsx');
  });
});

describe('POST /_api/pins (project server)', () => {
  const route = (designRoot: string, method: 'GET' | 'POST') => {
    const r = createPinsRoutes({ designRoot }).find((s) => s.method === method);
    if (!r) throw new Error('no route');
    return r;
  };

  test('pins and unpins in the same file Home writes', async () => {
    const a = makeProject('alpha', { 'ui/One.tsx': 'One' });
    const post = route(a.designRoot, 'POST');
    const r = await post.handle(
      new Request('http://127.0.0.1/_api/pins', {
        method: 'POST',
        body: JSON.stringify({ canvas: 'ui/One.tsx', pinned: true }),
      }),
      {}
    );
    expect(r.status).toBe(200);
    expect(readPins(a.designRoot).pins.map((p) => p.canvas)).toEqual(['ui/One.tsx']);
    const listed = (await (
      await route(a.designRoot, 'GET').handle(new Request('http://127.0.0.1/_api/pins'), {})
    ).json()) as {
      pins: unknown[];
    };
    expect(listed.pins).toHaveLength(1);
  });

  // S1.1: the Canvases panel's "Recently opened" order needs when each canvas was last opened here.
  test('GET also answers when each canvas was last opened on this Mac', async () => {
    const a = makeProject('alpha', { 'ui/One.tsx': 'One', 'ui/Two.tsx': 'Two' });
    stampRecent(a.designRoot, 'ui/Two.tsx', 1760001000000);
    const listed = (await (
      await route(a.designRoot, 'GET').handle(new Request('http://127.0.0.1/_api/pins'), {})
    ).json()) as { pins: unknown[]; opened: Record<string, number> };
    expect(listed.opened).toEqual({ 'ui/Two.tsx': 1760001000000 });
    expect(listed.pins).toEqual([]);
  });

  test('refuses a key outside the canvas vocabulary and a canvas that is not there', async () => {
    const a = makeProject('alpha', { 'ui/One.tsx': 'One' });
    const post = route(a.designRoot, 'POST');
    const send = (body: unknown) =>
      post.handle(
        new Request('http://127.0.0.1/_api/pins', { method: 'POST', body: JSON.stringify(body) }),
        {}
      );
    expect((await send({ canvas: '../x.tsx', pinned: true })).status).toBe(400);
    expect((await send({ canvas: 'ui/Ghost.tsx', pinned: true })).status).toBe(404);
    expect(existsSync(join(a.designRoot, '_canvas-state', '_pins.json'))).toBe(false);
  });

  test('is a main-origin route the read-only gate allows', () => {
    for (const s of createPinsRoutes({ designRoot: '/x' })) {
      expect(s.origin).toBe('main');
      expect(s.readOnly).toBe('allowed');
    }
  });
});
