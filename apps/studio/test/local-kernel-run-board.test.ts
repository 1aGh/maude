// gate-a-kernel (S4.20 G3, kernel half) — on a LOCAL project an AI run that changes the design AND
// resolves the stickies it answered lands as ONE `ai` action, so one ⌘Z takes back both.
//
// The run-tagged board batch (`run:<runId>`, http.ts annotationOps → server.ts onAnnotationsChanged)
// reaches the local kernel through `stageRunAnnotations` (annotations/run-tag.ts): begin + claim by
// hash + `proposeLane(…, { stageable: true })`. Before this fix the local `proposeLane` recorded the
// board as an immediate `edit` ("Edit annotations") outside the run, so ⌘Z needed two presses.
//
// A real in-process kernel over `bun:sqlite` in a temp project; the oracle is the store's history
// rows and the disk. server.ts's exact call sequence is replayed: the stageable proposal, then (a
// local home answers null) the plain stroke proposal with the same bytes.

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { stageRunAnnotations } from '../annotations/run-tag.ts';
import { serializeBoard } from '../annotations/schema.ts';
import { hashBytes } from '../sync/echo-guard.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const quiet = { warn() {}, error() {} };
const M1 = { id: 'm_mac_one', name: 'Mac one' };
const REL = 'ui/k.tsx';
const REPO_REL = `.design/${REL}`;
const SLUG = 'ui-k';
const BOARD_REL = `${SLUG}.annotations.json`;

const canvas = (title = 'P title') => `import { DCArtboard } from '@maude/canvas-lib';

export default function K() {
  return (
    <DCArtboard id="p" width={100} height={100}>
      <h1>${title}</h1>
    </DCArtboard>
  );
}
`;
const sticky = (id: string, index: string, resolved = false) => ({
  id,
  type: 'sticky',
  index,
  x: 0,
  y: 0,
  w: 200,
  h: 120,
  text: id,
  ...(resolved ? { resolved: { by: 'AI', at: '2026-10-19T00:00:00.000Z' } } : {}),
});
const board = (stickies: Array<[string, boolean]>) =>
  serializeBoard(stickies.map(([id, r], i) => sticky(id, `a${i}`, r)) as never);

function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-local-run-board-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  const file = (rel: string) => path.join(designRoot, rel);
  writeFileSync(file(REL), canvas());
  return {
    designRoot,
    read: (rel: string) => (existsSync(file(rel)) ? readFileSync(file(rel), 'utf8') : null),
    write: (rel: string, text: string) => writeFileSync(file(rel), text),
  };
}

function open(designRoot: string) {
  const h = openLocalHome({
    designRoot,
    designRel: '.design',
    canvasGroups: () => [{ path: 'ui' }],
    machine: M1,
    bootId: 'boot-1',
    lockRetryMs: 0,
    settleMs: 5,
    aiSettleMs: 0,
    log: quiet,
  });
  homes.push(h);
  return h;
}

type P = ReturnType<typeof project>;

/** The person's own stroke (server.ts onAnnotationsChanged without a run tag). */
async function personStroke(h: LocalHome, p: P, text: string) {
  const base = p.read(BOARD_REL);
  p.write(BOARD_REL, text);
  h.runtime.proposeLane(SLUG, 'annotations', text, base !== null ? { baseText: base } : undefined);
  await h.flush();
}

/** server.ts onAnnotationsChanged for a `run:<runId>` batch, call for call. */
function runBatch(h: LocalHome, p: P, runId: string, text: string) {
  const base = p.read(BOARD_REL) ?? undefined;
  p.write(BOARD_REL, text);
  const writeId = `run:${runId}`;
  const staged = stageRunAnnotations(h.runtime, {
    runId,
    open: true,
    chatId: 'c1',
    label: 'Answer stickies',
    slug: SLUG,
    canvasRel: REPO_REL,
    text,
    ...(base !== undefined ? { base } : {}),
    writeId,
  });
  // A local home answers null: server.ts falls through to the plain proposal (and the room bridge).
  expect(staged).toBeNull();
  h.runtime.proposeLane(SLUG, 'annotations', text, {
    writeId,
    ...(base !== undefined ? { baseText: base } : {}),
  });
}

/** A tool of the run writes the source: the claim first, then the watcher. */
async function toolWrite(h: LocalHome, p: P, key: string, body: string) {
  p.write(REL, body);
  h.runtime.claimAiWrite(key, REPO_REL, hashBytes(body));
  h.observe(REL);
  await h.flush();
}

const mineRows = (h: LocalHome) =>
  h.runtime.acceptedHistory({ path: REPO_REL, limit: 50, mine: true });

describe('S4.20 G3 — a run that resolves stickies is one action on a local project', () => {
  test('design change + resolves land as ONE ai action; one ⌘Z takes back both', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    // The person's stickies are on the record (so the board has a recorded base).
    await personStroke(
      h,
      p,
      board([
        ['s1', false],
        ['s2', false],
      ])
    );
    const before = p.read(BOARD_REL);
    const beforeRows = (await mineRows(h)).length;

    h.runtime.beginAiAction('acp:c1', 'Answer stickies', { runId: 'r_g3', chatId: 'c1' });
    await toolWrite(h, p, 'acp:c1', canvas('P title AI'));
    const resolved = board([
      ['s1', true],
      ['s2', true],
    ]);
    runBatch(h, p, 'r_g3', resolved);
    await h.flush();
    // Nothing of the run is on the record while it runs — not even an "Edit annotations".
    expect((await mineRows(h)).length).toBe(beforeRows);

    const ended = await h.runtime.endAiAction('acp:c1', 'done');
    expect(ended?.status).toBe('accepted');
    const rows = await mineRows(h);
    expect(rows.length).toBe(beforeRows + 1);
    const [top] = rows;
    expect([top.kind, top.label, top.runId]).toEqual(['ai', 'Answer stickies', 'r_g3']);
    expect(p.read(BOARD_REL)).toBe(resolved);

    // One ⌘Z: the design change AND the resolves go.
    const u = await h.runtime.acceptedUndo(top.actionId, false, { via: 'keys' });
    expect(u.status).toBe('accepted');
    expect(p.read(REL)).toBe(canvas());
    expect(p.read(BOARD_REL)).toBe(before);
  });

  test('a board-only run batch on a never-recorded board still lands inside the run', async () => {
    const p = project();
    p.write(BOARD_REL, board([['s1', false]]));
    const h = open(p.designRoot);
    await h.ready();
    const before = p.read(BOARD_REL);
    h.runtime.beginAiAction('acp:c2', 'Resolve', { runId: 'r_g3b', chatId: 'c2' });
    const resolved = board([['s1', true]]);
    runBatch(h, p, 'r_g3b', resolved);
    await h.flush();
    expect((await mineRows(h)).filter((r) => r.kind === 'edit')).toEqual([]);
    const ended = await h.runtime.endAiAction('acp:c2', 'done');
    expect(ended?.status).toBe('accepted');
    const [top] = await mineRows(h);
    expect([top.kind, top.runId]).toEqual(['ai', 'r_g3b']);
    const u = await h.runtime.acceptedUndo(top.actionId, false, { via: 'keys' });
    expect(u.status).toBe('accepted');
    expect(p.read(BOARD_REL)).toBe(before);
  });

  test('a stroke with no run open is still the person’s "Edit annotations"', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    await personStroke(h, p, board([['s1', false]]));
    await personStroke(
      h,
      p,
      board([
        ['s1', false],
        ['s2', false],
      ])
    );
    const [top] = await mineRows(h);
    expect([top.kind, top.label]).toEqual(['edit', 'Edit annotations']);
  });
});
