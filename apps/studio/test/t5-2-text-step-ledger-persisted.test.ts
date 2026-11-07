// T5.2 (#165) — the local home's text-step ledger survives a restart. The ledger (annotations/text-steps.ts)
// is what refuses a ⌘Z over a collaborator's text (kg maude/v2-p8-undo-collab-refuse-ledger-in-local-home);
// it lived in memory only, while the ⌘Z stack it guards reads the op log, which IS persisted. After a
// restart the same ⌘Z went through and dropped the collaborator's text. The ledger now keeps an
// append-only log in `_state/` (already runtime state, DDR-115), compacted under the same caps on open.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { serializeBoard } from '../annotations/schema.ts';
import {
  createTextStepLedger,
  decodeTextStepLog,
  encodeTextStepLine,
  type TextStep,
} from '../annotations/text-steps.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { createProjectUndoRoutes } from '../routes/project-undo.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const sticky = (id: string, text: string): AnnotationElement =>
  ({ id, type: 'sticky', index: 'a0', x: 0, y: 0, w: 200, h: 200, text }) as AnnotationElement;

const REL = 'ui/k.tsx';
const SLUG = 'ui-k';

function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-t52-ledger-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  writeFileSync(
    path.join(designRoot, REL),
    `import { DCArtboard } from '@maude/canvas-lib';
export default function K() {
  return <DCArtboard id="p" width={100} height={100}><p>k</p></DCArtboard>;
}
`
  );
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
    bootId: `boot-${homes.length}`,
    lockRetryMs: 0,
    settleMs: 5,
    aiSettleMs: 0,
    log: { warn() {}, error() {} },
  });
  homes.push(h);
  return h;
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

const editIds = async (h: LocalHome) =>
  (
    (await h.runtime.acceptedHistory({ limit: 50 })) as Array<{
      actionId: string;
      kind: string;
      revision: number;
    }>
  )
    .filter((r) => r.kind === 'edit')
    .sort((a, b) => b.revision - a.revision)
    .map((r) => r.actionId);

describe('the text-step ledger log', () => {
  const step = (text: string, contested: string[] = []): TextStep => ({
    slug: 'ui-k',
    slots: new Map([['s1', text]]),
    contested,
  });

  test('a line round-trips; a log for another project, or a garbled line, is not read', () => {
    const lines = [
      encodeTextStepLine('a1', step('one', ['s1'])),
      'not json',
      encodeTextStepLine('a2', step('two')),
    ];
    const got = decodeTextStepLog(
      `${JSON.stringify({ v: 1, project: 'p1' })}\n${lines.join('\n')}\n`,
      'p1'
    );
    expect(got.map(([id]) => id)).toEqual(['a1', 'a2']);
    expect(got[0][1].contested).toEqual(['s1']);
    expect(got[1][1].slots.get('s1')).toBe('two');
    expect(
      decodeTextStepLog(`${JSON.stringify({ v: 1, project: 'p2' })}\n${lines[0]}\n`, 'p1')
    ).toEqual([]);
  });

  test('a restored ledger keeps the caps', () => {
    const ledger = createTextStepLedger(2);
    for (const [id, s] of [
      ['a1', step('1')],
      ['a2', step('2')],
      ['a3', step('3')],
    ] as const)
      ledger.restore(id, s);
    expect(ledger.get('a1')).toBeUndefined();
    expect(ledger.get('a3')?.slots.get('s1')).toBe('3');
  });
});

describe('local home — a contested step stays refused after a restart', () => {
  test('⌘Z after reopening the project still answers undo-conflict; their text stays', async () => {
    const p = project();
    p.writeBoard([sticky('duo', 'shared')]);
    const h1 = open(p.designRoot);
    await h1.ready();
    const base = p.board();
    h1.runtime.proposeLane(SLUG, 'annotations', serializeBoard([sticky('duo', 'Peer: shared A')]), {
      baseText: base,
      contested: ['duo'],
    });
    p.writeBoard([sticky('duo', 'Peer: shared A')]);
    await h1.flush();
    const [id] = await editIds(h1);
    expect(id).toBeTruthy();
    h1.close();

    const h2 = open(p.designRoot);
    await h2.ready();
    expect((await editIds(h2))[0]).toBe(id);
    const r = await undo(h2, id);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('undo-conflict');
    expect(JSON.parse(p.board()).elements[0].text).toBe('Peer: shared A');
  });
});
