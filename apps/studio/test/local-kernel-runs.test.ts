// S5.5b — AI runs on a LOCAL project (V2-1.5 U21: U2, U6, U10, U12 + U13/U14 as on a synced one).
//
// A real in-process kernel over `bun:sqlite` in a temp project, the same run stage the hub link
// uses (sync/action-stage.ts). The oracle is the store's history rows and the disk: a run lands
// as ONE `ai` action (never `outside`), two runs on two artboards of one file land as two, the
// person's own edit during a run is its own `edit` action, and undo touches only its target.

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { hashBytes } from '../sync/echo-guard.ts';
import { type LocalHome, OUTSIDE_KIND, openLocalHome } from '../sync/local-kernel.ts';

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

/** Two artboards of one file, every changeable line apart from the next. */
const canvas = (o: { title?: string; foot?: string; s?: string; s2?: string } = {}) =>
  `import { DCArtboard } from '@maude/canvas-lib';

export default function K() {
  return (
    <div>
      <DCArtboard id="p" width={100} height={100}>
        <h1>${o.title ?? 'P title'}</h1>
        <p>keep one</p>
        <footer>${o.foot ?? 'P foot'}</footer>
      </DCArtboard>
      <p>keep two</p>
      <DCArtboard id="s" width={100} height={100}>
        <h1>${o.s ?? 'S title'}</h1>
        <p>keep three</p>
        <h2>${o.s2 ?? 'S sub'}</h2>
      </DCArtboard>
    </div>
  );
}
`;

function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-local-runs-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  const file = (rel: string) => path.join(designRoot, rel);
  writeFileSync(file(REL), canvas());
  return {
    designRoot,
    read: () => readFileSync(file(REL), 'utf8'),
    write: (body: string) => writeFileSync(file(REL), body),
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

/** A tool of run `key` writes `body`: the claim first (the ACP update / PostToolUse hash), then the watcher. */
async function toolWrite(h: LocalHome, p: ReturnType<typeof project>, key: string, body: string) {
  p.write(body);
  h.runtime.claimAiWrite(key, REPO_REL, hashBytes(body));
  h.observe(REL);
  await h.flush();
}

/** The person's edit through the studio's own write path (api.ts `source-written`). */
async function personWrite(h: LocalHome, p: ReturnType<typeof project>, body: string) {
  p.write(body);
  h.noteWritten(REL, body);
  h.observe(REL);
  await h.flush();
}

const rowsOf = async (h: LocalHome) => h.runtime.acceptedHistory({ limit: 50 });

describe('U21 — AI runs on a local project land like on a synced one', () => {
  test('U10: two runs on P and S of one file land as TWO ai actions; undo of the later keeps the other', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    h.runtime.beginAiAction('acp:c1', 'Restyle P', { runId: 'r_c1', chatId: 'c1' });
    h.runtime.beginAiAction('acp:c2', 'Restyle S', { runId: 'r_c2', chatId: 'c2' });
    const d1 = canvas({ foot: 'P foot NEW' });
    await toolWrite(h, p, 'acp:c1', d1);
    const d2 = canvas({ foot: 'P foot NEW', s: 'S title NEW' });
    await toolWrite(h, p, 'acp:c2', d2);
    // nothing of either run is in the log yet — and never as `outside`
    expect((await rowsOf(h)).map((r) => r.kind)).toEqual(['migration.import']);

    const e1 = await h.runtime.endAiAction('acp:c1', 'done');
    const e2 = await h.runtime.endAiAction('acp:c2', 'done');
    expect(e1?.status).toBe('accepted');
    expect(e2?.status).toBe('accepted');
    expect(e1?.touched).toEqual({ [REL]: ['p'] });
    expect(e2?.touched).toEqual({ [REL]: ['s'] });
    const rows = await rowsOf(h);
    expect(rows.slice(0, 2).map((r) => [r.kind, r.label, r.runId, r.chatId, r.mine])).toEqual([
      ['ai', 'Restyle S', 'r_c2', 'c2', true],
      ['ai', 'Restyle P', 'r_c1', 'c1', true],
    ]);
    expect(p.read()).toBe(d2);

    const u = await h.runtime.acceptedUndo(e2?.actionId as string);
    expect(u.status).toBe('accepted');
    expect(p.read()).toBe(d1);
  });

  test('U2: the person edits P during a run on P; ⌘Z on the run undoes only the run', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    h.runtime.beginAiAction('acp:c1', 'Footer', { runId: 'r_u2', chatId: 'c1' });
    await toolWrite(h, p, 'acp:c1', canvas({ foot: 'P foot AI' }));
    await personWrite(h, p, canvas({ foot: 'P foot AI', title: 'P title MINE' }));
    const [mine] = await rowsOf(h);
    expect([mine.kind, mine.mine]).toEqual(['edit', true]);
    const ended = await h.runtime.endAiAction('acp:c1', 'done');
    expect(ended?.status).toBe('accepted');
    const rows = await rowsOf(h);
    expect(rows[0].kind).toBe('ai');
    // gesture time orders the ⌘Z stack: the person's edit was made before the run landed
    expect((rows[0].madeAt ?? 0) >= (mine.madeAt ?? 0)).toBe(true);
    expect(p.read()).toBe(canvas({ foot: 'P foot AI', title: 'P title MINE' }));

    await h.runtime.acceptedUndo(rows[0].actionId);
    expect(p.read()).toBe(canvas({ title: 'P title MINE' }));
    await h.runtime.acceptedUndo(mine.actionId);
    expect(p.read()).toBe(canvas());
  });

  test('U12: Stop publishes the partial run as one version " — stopped"', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    h.runtime.beginAiAction('acp:c1', 'Big change', { runId: 'r_u12', chatId: 'c1' });
    await toolWrite(h, p, 'acp:c1', canvas({ s: 'half done' }));
    const r = await h.runtime.endAiAction('r_u12', 'stopped');
    expect(r?.status).toBe('accepted');
    const [row] = await rowsOf(h);
    expect([row.kind, row.label, row.partial]).toEqual(['ai', 'Big change — stopped', true]);
  });

  test('U6: Undo this chat takes back both of c1’s runs as ONE version; c2 and the person stay', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    h.runtime.beginAiAction('acp:c1', 'c1 run 1', { runId: 'r_61', chatId: 'c1' });
    await toolWrite(h, p, 'acp:c1', canvas({ foot: 'c1 foot' }));
    await h.runtime.endAiAction('acp:c1', 'done');
    h.runtime.beginAiAction('acp:c1', 'c1 run 2', { runId: 'r_62', chatId: 'c1' });
    await toolWrite(h, p, 'acp:c1', canvas({ foot: 'c1 foot', s: 'c1 S' }));
    await h.runtime.endAiAction('acp:c1', 'done');
    await personWrite(h, p, canvas({ foot: 'c1 foot', s: 'c1 S', title: 'mine' }));
    h.runtime.beginAiAction('acp:c2', 'c2 run', { runId: 'r_63', chatId: 'c2' });
    await toolWrite(
      h,
      p,
      'acp:c2',
      canvas({ foot: 'c1 foot', s: 'c1 S', title: 'mine', s2: 'c2' })
    );
    await h.runtime.endAiAction('acp:c2', 'done');
    const before = (await rowsOf(h)).length;

    const u = await h.runtime.acceptedUndo({ chatId: 'c1' }, false, { via: 'panel' });
    expect(u.status).toBe('accepted');
    expect(Array.isArray(u.undoes) && u.undoes.length).toBe(2);
    expect((await rowsOf(h)).length).toBe(before + 1);
    expect(p.read()).toBe(canvas({ title: 'mine', s2: 'c2' }));
  });

  test('U13: a failed run holds; discard puts the accepted content back with no action', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    h.runtime.beginAiAction('acp:c1', 'Broken', { runId: 'r_u13', chatId: 'c1' });
    await toolWrite(h, p, 'acp:c1', canvas({ s: 'broken' }));
    expect(await h.runtime.endAiAction('acp:c1', 'failed')).toBeNull();
    expect((await rowsOf(h)).map((r) => r.kind)).toEqual(['migration.import']);
    const d = await h.runtime.resolveAiAction('discard', 'r_u13');
    expect(d?.status).toBe('discarded');
    expect(p.read()).toBe(canvas());
    h.observe(REL);
    await h.flush();
    expect((await rowsOf(h)).map((r) => r.kind)).toEqual(['migration.import']);
  });

  test('U13: Keep on a held run publishes it as its ai action', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    h.runtime.beginAiAction('acp:c1', 'Kept', { runId: 'r_keep', chatId: 'c1' });
    await toolWrite(h, p, 'acp:c1', canvas({ s: 'kept' }));
    await h.runtime.endAiAction('acp:c1', 'failed');
    const k = await h.runtime.resolveAiAction('publish', 'r_keep');
    expect(k?.status).toBe('accepted');
    expect(k?.actionId).toBeTruthy();
    expect((await rowsOf(h))[0].kind).toBe('ai');
  });

  test('U14: a crash mid-run comes back held — the boot reconcile records nothing', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    h.runtime.beginAiAction('acp:c1', 'Crashed', { runId: 'r_u14', chatId: 'c1' });
    await toolWrite(h, p, 'acp:c1', canvas({ s: 'crashed' }));
    h.close();
    expect(existsSync(path.join(p.designRoot, '_state', 'ai-stage-local.json'))).toBe(true);
    const again = open(p.designRoot);
    await again.ready();
    expect((await rowsOf(again)).map((r) => r.kind)).toEqual(['migration.import']);
    expect(again.aiRuns().map((r) => [r.runId, r.state])).toEqual([['r_u14', 'held']]);
  });

  test('with no run open a watched write is still an outside action', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    p.write(canvas({ s: 'editor' }));
    h.observe(REL);
    await h.flush();
    expect((await rowsOf(h))[0].kind).toBe(OUTSIDE_KIND);
  });
});
