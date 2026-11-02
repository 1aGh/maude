// p8-fix-d F13 — a text session's idle-typing drafts are not ⌘Z steps of their own (V2-1.5 §3: a
// gesture is one step; DDR-242 AD7: "Drafts never reach undo"). The canvas marks a draft batch
// (`draft-…` write id, annotations/ui/text-session.ts); a room flush that carries only drafts
// projects with `draft: true`; the local home holds such a stroke back and records it with the
// next stroke on that board (the commit) as ONE step from the board before the first draft. A
// session whose commit had nothing left to change (its last draft was the final text) is recorded
// the moment anything reads the log (settled()), so ⌘Z right after it takes the whole session back.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { writeReplica } from '../annotations/replica.ts';
import { serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { draftWriteId, isDraftWriteId } from '../annotations/ui/text-session.ts';
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

describe('draft write ids', () => {
  test('a draft id is a valid annotation write id and is recognised', () => {
    const id = draftWriteId();
    expect(/^[a-zA-Z0-9_-]{1,96}$/.test(id)).toBe(true);
    expect(isDraftWriteId(id)).toBe(true);
    expect(isDraftWriteId(crypto.randomUUID())).toBe(false);
    expect(isDraftWriteId('run:abc')).toBe(false);
    expect(isDraftWriteId(undefined)).toBe(false);
  });
});

describe('room — a flush that carries only drafts is a draft projection', () => {
  const callbacks = (): RoomCallbacks => ({
    async seed() {},
    async persistJson() {},
    async persistBinary() {},
  });
  const roomWith = (els: AnnotationElement[]) => {
    const registry = createRegistry(callbacks());
    writeReplica(registry.get('ui-k').doc, els);
    return registry;
  };
  const draft = (text: string, expect: string) => ({
    op: 'patch' as const,
    id: 'duo',
    set: { text },
    expect: { text: expect },
  });

  test('drafts only → draft; taken, the next flush starts clean', () => {
    const registry = roomWith([sticky('duo', 'a')]);
    registry.applyOpsToRoom('ui-k', [draft('ab', 'a')], draftWriteId());
    registry.applyOpsToRoom('ui-k', [draft('abc', 'ab')], draftWriteId());
    expect(registry.takeDraftOnly('ui-k')).toBe(true);
    expect(registry.takeDraftOnly('ui-k')).toBe(false);
  });

  test('a draft and the commit in one flush → not a draft', () => {
    const registry = roomWith([sticky('duo', 'a')]);
    registry.applyOpsToRoom('ui-k', [draft('ab', 'a')], draftWriteId());
    registry.applyOpsToRoom('ui-k', [draft('abc', 'ab')], crypto.randomUUID());
    expect(registry.takeDraftOnly('ui-k')).toBe(false);
  });

  test('a file import between drafts → not a draft (it is not this session’s typing)', () => {
    const registry = roomWith([sticky('duo', 'a')]);
    registry.applyOpsToRoom('ui-k', [draft('ab', 'a')], draftWriteId());
    registry.syncRoomFromAnnotations(
      'ui-k',
      serializeBoard([sticky('duo', 'ab'), sticky('x', 'y')])
    );
    expect(registry.takeDraftOnly('ui-k')).toBe(false);
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
  const root = mkdtempSync(path.join(tmpdir(), 'maude-draft-steps-'));
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

type How = { draft?: boolean; writeId?: string; contested?: string[] };

/** A stroke as the studio delivers it (room projection or the disk path): proposed, then written. */
async function stroke(
  h: LocalHome,
  p: ReturnType<typeof project>,
  els: AnnotationElement[],
  how: How = {}
) {
  const base = p.board();
  h.runtime.proposeLane(SLUG, 'annotations', serializeBoard(els), {
    baseText: base,
    ...(how.draft ? { draft: true } : {}),
    ...(how.writeId ? { writeId: how.writeId } : {}),
    ...(how.contested ? { contested: how.contested } : {}),
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

const edits = async (h: LocalHome) => {
  const rows = (await h.runtime.acceptedHistory({ limit: 50 })) as Array<{
    actionId: string;
    kind: string;
    revision: number;
  }>;
  return rows
    .filter((r) => r.kind === 'edit')
    .sort((a, b) => b.revision - a.revision)
    .map((r) => r.actionId);
};

const textOf = (p: ReturnType<typeof project>, id: string) =>
  (JSON.parse(p.board()).elements as Array<{ id: string; text?: string }>).find((e) => e.id === id)
    ?.text;

describe('local home — one text session is one ⌘Z step', () => {
  test('two drafts and the commit record ONE edit; one ⌘Z restores the text before the session', async () => {
    const p = project();
    p.writeBoard([sticky('duo', 'Hello')]);
    const h = open(p.designRoot);
    await h.ready();
    await stroke(h, p, [sticky('duo', 'Hello w')], { draft: true });
    await stroke(h, p, [sticky('duo', 'Hello wor')], { draft: true });
    await stroke(h, p, [sticky('duo', 'Hello world')]);
    const ids = await edits(h);
    expect(ids.length).toBe(1);
    const r = await undo(h, ids[0]);
    expect(r.status).toBe(200);
    await h.flush();
    expect(textOf(p, 'duo')).toBe('Hello');
  });

  test('a session whose last draft was the final text is one step all the same', async () => {
    const p = project();
    p.writeBoard([sticky('duo', 'Hello')]);
    const h = open(p.designRoot);
    await h.ready();
    await stroke(h, p, [sticky('duo', 'Hello w')], { draft: true });
    await stroke(h, p, [sticky('duo', 'Hello world')], { draft: true });
    // the commit found nothing left to change: no stroke. ⌘Z reads the log first (refresh).
    const ids = await edits(h);
    expect(ids.length).toBe(1);
    const r = await undo(h, ids[0]);
    expect(r.status).toBe(200);
    await h.flush();
    expect(textOf(p, 'duo')).toBe('Hello');
  });

  test('the disk path (no live room) knows a draft by its write id', async () => {
    const p = project();
    p.writeBoard([sticky('duo', 'Hello')]);
    const h = open(p.designRoot);
    await h.ready();
    await stroke(h, p, [sticky('duo', 'Hello w')], { writeId: draftWriteId() });
    await stroke(h, p, [sticky('duo', 'Hello world')], { writeId: crypto.randomUUID() });
    const ids = await edits(h);
    expect(ids.length).toBe(1);
    expect((await undo(h, ids[0])).status).toBe(200);
    await h.flush();
    expect(textOf(p, 'duo')).toBe('Hello');
  });

  test('a collaborator’s text merged during a draft still refuses the session’s ⌘Z', async () => {
    const p = project();
    p.writeBoard([sticky('duo', 'shared')]);
    const h = open(p.designRoot);
    await h.ready();
    await stroke(h, p, [sticky('duo', 'Peer: shared A')], { draft: true, contested: ['duo'] });
    await stroke(h, p, [sticky('duo', 'Peer: shared A B')]);
    const ids = await edits(h);
    expect(ids.length).toBe(1);
    const r = await undo(h, ids[0]);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('undo-conflict');
    expect(textOf(p, 'duo')).toBe('Peer: shared A B');
  });

  test('two sessions are two steps', async () => {
    const p = project();
    p.writeBoard([sticky('duo', 'a'), sticky('two', 'b', 'a1')]);
    const h = open(p.designRoot);
    await h.ready();
    await stroke(h, p, [sticky('duo', 'a1'), sticky('two', 'b', 'a1')], { draft: true });
    await stroke(h, p, [sticky('duo', 'a12'), sticky('two', 'b', 'a1')]);
    await stroke(h, p, [sticky('duo', 'a12'), sticky('two', 'b1', 'a1')], { draft: true });
    await stroke(h, p, [sticky('duo', 'a12'), sticky('two', 'b12', 'a1')]);
    const ids = await edits(h);
    expect(ids.length).toBe(2);
    expect((await undo(h, ids[0])).status).toBe(200);
    await h.flush();
    expect(textOf(p, 'two')).toBe('b');
    expect(textOf(p, 'duo')).toBe('a12');
  });
});
