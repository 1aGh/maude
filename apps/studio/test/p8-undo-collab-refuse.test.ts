// p8-undo-collab-refuse — ⌘Z on an annotation text a collaborator changed meanwhile is refused
// (Michal 2026-10-29, option b2, kg maude/v2-michal-undo-refuses-over-collaborator-text; lead
// maude/v2-p8-undo-collab-refuse-studio-route-not-kernel). Their text stays, the shell shows its
// existing "Can't undo … — someone else changed it since" notice (409 `undo-conflict`).
//
//   room   — a batch whose text patch was merged 3-way (its `expect` is not what the field held)
//            marks that element's text as contested until the room's next projection;
//   route  — POST /_api/project/undo answers 409 `undo-conflict` for a contested step, and for a
//            step whose text slot no longer holds what the step left there; a clean step undoes.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { writeReplica } from '../annotations/replica.ts';
import { serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
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

const sticky = (id: string, text: string, index = 'a0'): AnnotationElement =>
  ({ id, type: 'sticky', index, x: 0, y: 0, w: 200, h: 200, text }) as AnnotationElement;
const shape = (id: string, text: string): AnnotationElement =>
  ({
    id,
    type: 'shape',
    index: 'a1',
    shape: 'rect',
    x: 300,
    y: 0,
    w: 100,
    h: 100,
    label: { text },
  }) as unknown as AnnotationElement;

describe('room — a 3-way-merged text batch marks the element contested', () => {
  const callbacks = (): RoomCallbacks => ({
    async seed() {},
    async persistJson() {},
    async persistBinary() {},
  });
  const roomWith = (els: AnnotationElement[]) => {
    const registry = createRegistry(callbacks());
    const room = registry.get('ui-k');
    writeReplica(room.doc, els);
    return registry;
  };

  test('a commit whose expect is not the current text (a collaborator typed meanwhile) is contested', () => {
    const registry = roomWith([sticky('duo', 'Peer: shared A')]);
    registry.applyOpsToRoom('ui-k', [
      { op: 'patch', id: 'duo', set: { text: 'shared A B' }, expect: { text: 'shared A' } },
    ]);
    expect(registry.takeTextContest('ui-k')).toEqual(['duo']);
    // taken: the next projection starts clean
    expect(registry.takeTextContest('ui-k')).toEqual([]);
  });

  test('a shape label merged against another text is contested too', () => {
    const registry = roomWith([shape('box', 'Peer: Ahoj')]);
    registry.applyOpsToRoom('ui-k', [
      {
        op: 'patch',
        id: 'box',
        set: { label: { text: 'Ahoj!' } },
        expect: { label: { text: 'Ahoj' } },
      },
    ]);
    expect(registry.takeTextContest('ui-k')).toEqual(['box']);
  });

  test('own drafts (each expects the last one) and an unrelated field are not contested', () => {
    const registry = roomWith([sticky('duo', 'shared')]);
    registry.applyOpsToRoom('ui-k', [
      { op: 'patch', id: 'duo', set: { text: 'shared A' }, expect: { text: 'shared' } },
    ]);
    registry.applyOpsToRoom('ui-k', [
      { op: 'patch', id: 'duo', set: { text: 'shared A B' }, expect: { text: 'shared A' } },
    ]);
    registry.applyOpsToRoom('ui-k', [
      { op: 'patch', id: 'duo', set: { x: 40 }, expect: { x: 99 } },
    ]);
    expect(registry.takeTextContest('ui-k')).toEqual([]);
  });
});

const REL = 'ui/k.tsx';
const SLUG = 'ui-k';
const CANVAS = `import { DCArtboard } from '@maude/canvas-lib';
export default function K() {
  return <DCArtboard id="p" width={100} height={100}><p>k</p></DCArtboard>;
}
`;

function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-undo-collab-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  writeFileSync(path.join(designRoot, REL), CANVAS);
  const boardFile = path.join(designRoot, `${SLUG}.annotations.json`);
  return {
    designRoot,
    board: () => readFileSync(boardFile, 'utf8'),
    writeBoard: (els: AnnotationElement[]) => writeFileSync(boardFile, serializeBoard(els)),
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

/** A room projection, as collab/index.ts emits it: proposed first, then written. */
async function stroke(
  h: LocalHome,
  p: ReturnType<typeof project>,
  els: AnnotationElement[],
  contested: string[] = []
) {
  let base: string | undefined;
  try {
    base = p.board();
  } catch {
    base = undefined;
  }
  h.runtime.proposeLane(SLUG, 'annotations', serializeBoard(els), {
    ...(base !== undefined ? { baseText: base } : {}),
    contested,
  });
  p.writeBoard(els);
  await h.flush();
}

async function undo(h: LocalHome, actionId: string) {
  const spec = createProjectUndoRoutes({
    control: () => h.runtime as never,
    designRel: '.design',
  }).find((s) => s.method === 'POST' && s.path === '/_api/project/undo');
  if (!spec) throw new Error('no undo route');
  const res = await spec.handle(
    new Request('http://localhost/_api/project/undo', {
      method: 'POST',
      body: JSON.stringify({ actionId, via: 'keys' }),
      headers: { 'content-type': 'application/json' },
    }),
    {} as never
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const newestEdit = async (h: LocalHome) => {
  const rows = (await h.runtime.acceptedHistory({ limit: 50 })) as Array<{
    actionId: string;
    kind: string;
    revision: number;
  }>;
  const edits = rows.filter((r) => r.kind === 'edit').sort((a, b) => b.revision - a.revision);
  return edits.map((r) => r.actionId);
};

const textOf = (p: ReturnType<typeof project>, id: string) =>
  (JSON.parse(p.board()).elements as Array<{ id: string; text?: string }>).find((e) => e.id === id)
    ?.text;

describe('route — ⌘Z on a text a collaborator changed is refused', () => {
  test('a contested step answers 409 undo-conflict and the collaborator’s text stays', async () => {
    const p = project();
    p.writeBoard([sticky('duo', 'shared')]);
    const h = open(p.designRoot);
    await h.ready();
    await stroke(h, p, [sticky('duo', 'shared A')]);
    // the peer's prefix and the commit flushed together; the commit merged 3-way
    await stroke(h, p, [sticky('duo', 'Peer: shared A B')], ['duo']);
    const [top] = await newestEdit(h);
    const r = await undo(h, top);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('undo-conflict');
    expect(textOf(p, 'duo')).toBe('Peer: shared A B');
  });

  test('an older step whose text no longer holds what it left is refused too', async () => {
    const p = project();
    p.writeBoard([sticky('duo', 'shared')]);
    const h = open(p.designRoot);
    await h.ready();
    await stroke(h, p, [sticky('duo', 'shared A')]);
    await stroke(h, p, [sticky('duo', 'Peer: shared A B')], ['duo']);
    const [top, older] = await newestEdit(h);
    expect((await undo(h, top)).status).toBe(409);
    // the refused step stays applied: the older step's 'shared A' is gone from the board
    const r = await undo(h, older);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('undo-conflict');
    expect(textOf(p, 'duo')).toBe('Peer: shared A B');
  });

  test('a clean step of your own still undoes', async () => {
    const p = project();
    p.writeBoard([sticky('duo', 'shared'), sticky('two', 'other', 'a1')]);
    const h = open(p.designRoot);
    await h.ready();
    await stroke(h, p, [sticky('duo', 'shared A'), sticky('two', 'other', 'a1')]);
    const [top] = await newestEdit(h);
    const r = await undo(h, top);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    await h.flush();
    expect(textOf(p, 'duo')).toBe('shared');
  });
});
