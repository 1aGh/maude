// #216 — ⌘Z did not undo an annotation edit, and a section move "deleted some elements inside".
//
// Root cause: an annotation gesture made while the canvas is open lands in the canvas's live collab
// room (`applyAnnotationOpsLive`). The room reaches the op log only when its DEBOUNCED flush projects
// the board (800 ms, re-armed by every doc update — collab/room.ts). ⌘Z reads the stack
// (`GET /_api/project/undo-stack`) right away, so the gesture is not on it yet: ⌘Z either finds
// nothing or takes back the step BEFORE it — e.g. the creation of the stickies inside the section the
// person just moved. That is the "moving the section deleted elements" of the report: the move stayed,
// the earlier step was undone.
//
// Fix: the stack read settles the canvas's live room first (`settle`, wired in http.ts to
// `registry.peek(slug).flush()`), and a room's `flush()` waits for a flush already writing instead of
// returning while it is still on its way (`dirty` was already cleared).

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type * as Y from 'yjs';

import { replicaBoardText, writeReplica } from '../annotations/replica.ts';
import { serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { canvasSlugFromRel } from '../canvas-slug.ts';
import { createUndoProjection } from '../client/v2/undo/use-undo-projection.jsx';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import { createProjectUndoRoutes } from '../routes/project-undo.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const REL = 'ui/team.tsx';
const REPO_REL = `.design/${REL}`;
const SLUG = 'ui-team';
const CANVAS = `import { DCArtboard } from '@maude/canvas-lib';
export default function T() {
  return <DCArtboard id="p" width={100} height={100}><p>t</p></DCArtboard>;
}
`;

const section = (x: number): AnnotationElement =>
  ({
    id: 'sec',
    type: 'section',
    index: 'a0',
    x,
    y: 0,
    w: 800,
    h: 600,
    label: 'Team',
  }) as AnnotationElement;
const sticky = (id: string, x: number, index: string): AnnotationElement =>
  ({
    id,
    type: 'sticky',
    index,
    parent: 'sec',
    x,
    y: 40,
    w: 200,
    h: 200,
    text: id,
  }) as AnnotationElement;

function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-w6-216-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  writeFileSync(path.join(designRoot, REL), CANVAS);
  const boardFile = path.join(designRoot, `${SLUG}.annotations.json`);
  return {
    designRoot,
    board: () => JSON.parse(readFileSync(boardFile, 'utf8')) as { elements: AnnotationElement[] },
    boardText: () => {
      try {
        return readFileSync(boardFile, 'utf8');
      } catch {
        return undefined;
      }
    },
    writeBoardText: (t: string) => writeFileSync(boardFile, t),
  };
}

function open(designRoot: string) {
  const h = openLocalHome({
    designRoot,
    designRel: '.design',
    canvasGroups: () => [{ path: 'ui' }],
    machine: { id: 'm_mac_one', name: 'Mac one' },
    bootId: 'boot-1',
    lockRetryMs: 0,
    settleMs: 5,
    aiSettleMs: 0,
    log: { warn() {}, error() {} },
  });
  homes.push(h);
  return h;
}

/** A room whose flush projects the board the way collab/index.ts + persistence.ts do: proposed, then written. */
function liveRoom(h: LocalHome, p: ReturnType<typeof project>) {
  const callbacks: RoomCallbacks = {
    async seed() {},
    async persistJson(_slug: string, doc: Y.Doc) {
      const board = replicaBoardText(doc);
      if (board === null) return;
      const base = p.boardText();
      h.runtime.proposeLane(
        SLUG,
        'annotations',
        board,
        base !== undefined ? { baseText: base } : {}
      );
      p.writeBoardText(board);
    },
    async persistBinary() {},
  };
  const registry = createRegistry(callbacks);
  return registry;
}

function undoStore(h: LocalHome, settle?: (repoRel: string) => Promise<void>) {
  const specs = createProjectUndoRoutes({
    control: () => h.runtime as never,
    designRel: '.design',
    ...(settle ? { settle } : {}),
  });
  const request = async (method: string, url: string, body?: unknown) => {
    const u = new URL(url, 'http://studio.test');
    const spec = specs.find((s) => s.method === method && s.path === u.pathname);
    if (!spec) return { status: 404, body: null };
    const res = await spec.handle(
      new Request(u, {
        method,
        ...(body !== undefined
          ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
          : {}),
      }),
      {} as never
    );
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return createUndoProjection({
    request,
    now: () => 0,
    announce: () => {},
    designRel: () => '.design',
    ownRunOn: () => false,
  } as never);
}

const ids = (p: ReturnType<typeof project>) =>
  p
    .board()
    .elements.map((e) => e.id)
    .sort();
const secX = (p: ReturnType<typeof project>) => p.board().elements.find((e) => e.id === 'sec')?.x;

describe('#216 — ⌘Z right after a gesture in a live room undoes THAT gesture', () => {
  test('section moved, ⌘Z at once: the move goes back and the stickies inside stay', async () => {
    const p = project();
    p.writeBoardText(serializeBoard([section(0)]));
    const h = open(p.designRoot);
    await h.ready();
    const registry = liveRoom(h, p);
    const room = registry.get(SLUG);
    writeReplica(room.doc, [section(0)], 'seed');
    // step 1 — two stickies put inside the section, flushed: an op-log step ("Edit annotations")
    registry.applyOpsToRoom(
      SLUG,
      [
        { op: 'put', el: sticky('a', 20, 'a0') },
        { op: 'put', el: sticky('b', 300, 'a1') },
      ],
      crypto.randomUUID()
    );
    await room.flush();
    await h.flush();
    expect(ids(p)).toEqual(['a', 'b', 'sec']);
    // step 2 — the person drags the section; the room has it, its 800 ms flush has not run yet
    registry.applyOpsToRoom(
      SLUG,
      [{ op: 'patch', id: 'sec', set: { x: 400 }, expect: { x: 0 } }],
      crypto.randomUUID()
    );
    // what server.ts wires: the room of the canvas the stack is read for
    const store = undoStore(h, async (repoRel) => {
      await registry.peek(canvasSlugFromRel(repoRel, '.design'))?.flush();
    });
    await store.open(REPO_REL);
    const r = (await store.undo(REPO_REL)) as { ok?: boolean };
    expect(r.ok).toBe(true);
    await h.flush();
    // the move is what went back — not the step that made the stickies
    expect(ids(p)).toEqual(['a', 'b', 'sec']);
    expect(secX(p)).toBe(0);
    room.destroy();
  });
});

describe('the undo-stack read settles the canvas first', () => {
  test('GET /_api/project/undo-stack awaits settle(canvas) before it reads the history', async () => {
    const order: string[] = [];
    const specs = createProjectUndoRoutes({
      control: () =>
        ({
          acceptedHistory: async () => {
            order.push('read');
            return [];
          },
        }) as never,
      designRel: '.design',
      settle: async (repoRel: string) => {
        await new Promise((r) => setTimeout(r, 5));
        order.push(`settle ${repoRel}`);
      },
    });
    const spec = specs.find((s) => s.method === 'GET' && s.path === '/_api/project/undo-stack');
    if (!spec) throw new Error('no route');
    const res = await spec.handle(
      new Request(
        `http://studio.test/_api/project/undo-stack?canvas=${encodeURIComponent(REPO_REL)}`
      ),
      {} as never
    );
    expect(res.status).toBe(200);
    expect(order).toEqual([`settle ${REPO_REL}`, 'read']);
  });

  test('a settle that throws never blocks the read', async () => {
    const specs = createProjectUndoRoutes({
      control: () => ({ acceptedHistory: async () => [] }) as never,
      designRel: '.design',
      settle: async () => {
        throw new Error('room gone');
      },
    });
    const spec = specs.find((s) => s.method === 'GET' && s.path === '/_api/project/undo-stack');
    const res = await spec?.handle(
      new Request(
        `http://studio.test/_api/project/undo-stack?canvas=${encodeURIComponent(REPO_REL)}`
      ),
      {} as never
    );
    expect((await res?.json()) as { ok: boolean }).toMatchObject({ ok: true });
  });
});

describe('room.flush() waits for a flush already writing', () => {
  test('a second flush resolves only after the first one has projected the board', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let projected = 0;
    const registry = createRegistry({
      async seed() {},
      async persistJson() {
        await gate;
        projected++;
      },
      async persistBinary() {},
    });
    const room = registry.get('ui-x');
    writeReplica(room.doc, [section(0)]);
    const first = room.flush(); // takes the dirty flag, then waits on the gate
    let secondDone = false;
    const second = room.flush().then(() => {
      secondDone = true;
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(secondDone).toBe(false);
    release();
    await Promise.all([first, second]);
    expect(projected).toBe(1);
    room.destroy();
  });
});

describe('the studio wires it', () => {
  const src = (f: string) => readFileSync(path.join(import.meta.dir, '..', f), 'utf8');
  test('server.ts flushes the canvas room; http.ts hands it to the undo routes as `settle`', () => {
    expect(src('server.ts')).toContain(
      'await collab?.registry.peek(api.fileSlug(repoRel))?.flush();'
    );
    expect(src('http.ts')).toContain(
      '...(opts.settleCanvasRoom ? { settle: opts.settleCanvasRoom } : {}),'
    );
  });
});
