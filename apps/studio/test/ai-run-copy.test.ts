// S5.11b — Run on a copy, the server half (V2-1.15 §5.7, R9): `POST /_api/ai/runs/:id/copy`.
// A waiting ask on a busy artboard gets a duplicate of that artboard, built from the ACCEPTED
// content (never the busy run's staged bytes), with fresh element ids, placed beside the original;
// the ask is re-scoped to it, leases it and starts. One copy per ask; a race with the holder
// finishing first resolves to exactly one outcome.
// Red first: before S5.11b there is no `/copy` route, no `applyCopyArtboard`, no `copyReserve`.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createLocalLeaseHome } from '../ai/lease-home.ts';
import type { RunRecord } from '../ai/run-lifecycle.ts';
import { createRunRegistry } from '../ai/runs.ts';
import { applyCopyArtboard, copyArtboard } from '../canvas-edit.ts';
import { walkIdElements } from '../element-ids.ts';
import { createAiRoutes } from '../routes/ai.ts';
import { matchRoute } from '../routes/table.ts';
import { hashBytes } from '../sync/echo-guard.ts';

const tick = () => new Promise((r) => setTimeout(r, 0));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ACCEPTED = `export default function C() {
  return (
    <DesignCanvas>
      <DCArtboard id="P" label="Post 1:1" width={260} height={260}>
        <h1 data-cd-id="headline" data-cd-locked="1">Make it count</h1>
        <p data-cd-id="date">So 14. 3.</p>
        <span>plain</span>
      </DCArtboard>
      <DCArtboard id="S" label="Story" width={260} height={460}>
        <h1>Story</h1>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
// the busy run's staged bytes: on disk, not yet accepted
const STAGED = ACCEPTED.replace('Make it count', 'GREENER (busy run)');

function project(disk = STAGED) {
  const root = mkdtempSync(path.join(tmpdir(), 'ai-copy-'));
  dirs.push(root);
  mkdirSync(path.join(root, '.design', 'ui'), { recursive: true });
  const abs = path.join(root, '.design', 'ui', 'C.tsx');
  writeFileSync(abs, disk);
  return { root, abs };
}

const artboardIds = (src: string) =>
  [...src.matchAll(/<DCArtboard id="([^"]+)"/g)].map((m) => m[1]);

describe('applyCopyArtboard — the canvas half', () => {
  test('from the accepted content, beside the original, new artboard id + label, new element ids, unlocked', () => {
    const out = applyCopyArtboard('/x/C.tsx', STAGED, ACCEPTED, 'P', { id: 'P-copy-abc123' });
    expect(out.existed).toBe(false);
    // beside the original: the next sibling in source order (the "Duplicate at width…" rule)
    expect(artboardIds(out.source)).toEqual(['P', 'P-copy-abc123', 'S']);
    const copy = out.source.slice(
      out.source.indexOf('<DCArtboard id="P-copy-abc123"'),
      out.source.indexOf('<DCArtboard id="S"')
    );
    expect(copy).toContain('label="Post 1:1 · copy"');
    expect(copy).toContain('Make it count'); // accepted, not the staged headline
    expect(copy).not.toContain('GREENER');
    expect(copy).not.toContain('data-cd-locked');
    // the original keeps its (staged) bytes and its ids
    expect(out.source).toContain('GREENER (busy run)');
    const walk = walkIdElements(out.source, 'C.tsx');
    if (!walk.ok) throw new Error(walk.error);
    const ids = walk.elements.filter((e) => e.id).map((e) => [e.artboard, e.id]);
    const copyIds = ids.filter(([a]) => a === 'P-copy-abc123').map(([, id]) => id);
    expect(copyIds).toHaveLength(2); // headline + date got fresh ids; the plain span stays lazy
    expect(copyIds).not.toContain('headline');
    expect(copyIds).not.toContain('date');
    expect(new Set(ids.map(([, id]) => id)).size).toBe(ids.length); // no id on two elements
  });

  test('an artboard with the copy id already there is the same ask’s copy: answered as is', () => {
    const once = applyCopyArtboard('/x/C.tsx', STAGED, ACCEPTED, 'P', { id: 'P-copy-abc123' });
    const twice = applyCopyArtboard('/x/C.tsx', once.source, ACCEPTED, 'P', {
      id: 'P-copy-abc123',
    });
    expect(twice).toEqual({ source: once.source, artboardId: 'P-copy-abc123', existed: true });
  });

  test('an artboard that is not in the accepted version yet is refused', () => {
    const disk = STAGED.replace(
      '<DCArtboard id="S"',
      '<DCArtboard id="N" width={1} height={1} />\n      <DCArtboard id="S"'
    );
    expect(() => applyCopyArtboard('/x/C.tsx', disk, ACCEPTED, 'N', { id: 'N-copy-1' })).toThrow(
      /not in the accepted version/
    );
  });
});

// ── the route over a real registry ─────────────────────────────────────────────────────────

function setup(over: Partial<Parameters<typeof createAiRoutes>[0]> = {}) {
  const { root, abs } = project();
  const sent: Array<{ runId: string; prompt: string | undefined; scope: unknown }> = [];
  const reg = createRunRegistry({
    designRoot: null,
    home: createLocalLeaseHome({ actor: 'you' }),
    autoRenew: false,
    turns: {
      send: (r) => void sent.push({ runId: r.runId, prompt: r.prompt, scope: r.scope }),
    },
  });
  const calls: string[] = [];
  const specs = createAiRoutes({
    registry: reg,
    repoRoot: root,
    designRel: '.design',
    control: () => ({
      acceptedCanvas: (rel) => {
        calls.push(`accepted ${rel}`);
        return ACCEPTED;
      },
      beginAiAction: (key, label, meta) =>
        void calls.push(`begin ${key} ${label} ${JSON.stringify(meta)}`),
      claimAiWrite: (key, rel, hash) => void calls.push(`claim ${key} ${rel} ${hash}`),
    }),
    ...over,
  });
  const copy = async (runId: string) => {
    const url = `/_api/ai/runs/${runId}/copy`;
    const m = matchRoute(specs, 'POST', url);
    if (!m) throw new Error(`no route POST ${url}`);
    const res = await m.spec.handle(
      new Request(`http://localhost${url}`, { method: 'POST' }),
      m.params
    );
    // biome-ignore lint/suspicious/noExplicitAny: the route's JSON, read loosely
    return { status: res.status, body: (await res.json()) as any };
  };
  const ask = (chatId: string, prompt?: string) =>
    reg.ask({
      chatId,
      origin: 'maude-chat',
      label: chatId,
      ...(prompt ? { prompt } : {}),
      scope: { canvas: 'ui/C.tsx', artboards: ['P'] },
    });
  return { reg, specs, copy, ask, abs, sent, calls };
}

const P = { canvas: 'path:.design/ui/C.tsx', artboard: 'P' };

describe('POST /_api/ai/runs/:id/copy', () => {
  test('R9: a waiting ask runs at once on a copy of the accepted artboard; its ticket leaves the line', async () => {
    const { reg, copy, ask, abs, sent, calls } = setup();
    const busy = await ask('c1', 'Make it greener');
    await reg.started(busy.runId);
    const w = await ask('c2', 'Headline in one word\n[maude-scope artboards="P"]');
    const third = await ask('c3', 'Club green');
    expect(reg.get(w.runId)?.state).toBe('waiting');

    const res = await copy(w.runId);
    expect(res.status).toBe(200);
    const copyId = res.body.copy.artboard as string;
    expect(res.body.copy).toEqual({ canvas: 'ui/C.tsx', artboard: copyId, of: 'P' });
    expect(copyId).toMatch(/^P-copy-[a-z0-9]{1,6}$/);
    expect(JSON.stringify(res.body)).not.toContain('Headline in one word'); // RunView, no prompt

    const disk = readFileSync(abs, 'utf8');
    expect(artboardIds(disk)).toEqual(['P', copyId, 'S']);
    expect(disk.slice(disk.indexOf(copyId))).toContain('Make it count');

    const run = reg.get(w.runId) as RunRecord;
    expect(run.state).not.toBe('waiting');
    expect(run.scope).toEqual({ canvas: 'ui/C.tsx', artboards: [copyId] });
    expect(run.copyOf).toEqual(P);
    expect(run.leases.map((l) => l.artboard)).toEqual([copyId]);
    expect(run.waiting).toEqual([]);
    // the turn is told to edit the copy, not the busy original
    await tick();
    const turn = sent.find((s) => s.runId === w.runId);
    expect(turn?.prompt).toContain(`[maude-scope artboards="${copyId}"]`);
    expect(turn?.prompt).not.toContain('artboards="P"');
    // the copy is the waiting run's own write: its stage, claimed before the write
    const written = readFileSync(abs, 'utf8');
    expect(calls).toEqual([
      'accepted .design/ui/C.tsx',
      // the chat run's stage IS the run: the tracker joins it, the registry ends it
      `begin ${w.runId} Claude: c2 ${JSON.stringify({ runId: w.runId, chatId: 'c2' })}`,
      `claim ${w.runId} .design/ui/C.tsx ${hashBytes(written)}`,
    ]);
    // the line moved up: when the holder finishes, the third ask gets P (not the copied ask)
    await reg.turnEnded(busy.runId, 'done');
    await tick();
    expect(reg.get(third.runId)?.state).not.toBe('waiting');
    expect(reg.get(third.runId)?.leases.map((l) => l.artboard)).toEqual(['P']);
  });

  test('one copy per ask: a retry and two concurrent calls make one copy', async () => {
    const { reg, copy, ask, abs } = setup();
    await reg.started((await ask('c1')).runId);
    const w = await ask('c2');
    const [a, b] = await Promise.all([copy(w.runId), copy(w.runId)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.body.copy).toEqual(a.body.copy);
    const again = await copy(w.runId);
    expect(again.status).toBe(200);
    expect(again.body.copy).toEqual(a.body.copy);
    expect(artboardIds(readFileSync(abs, 'utf8'))).toHaveLength(3);
  });

  test('race: the holder finished first → the ask runs on the original, no copy is written', async () => {
    const { reg, copy, ask, abs } = setup();
    const busy = await ask('c1');
    await reg.started(busy.runId);
    const w = await ask('c2');
    await reg.turnEnded(busy.runId, 'done');
    await tick();
    expect(reg.get(w.runId)?.state).not.toBe('waiting');
    const res = await copy(w.runId);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('state');
    expect(artboardIds(readFileSync(abs, 'utf8'))).toEqual(['P', 'S']);
    expect(reg.get(w.runId)?.leases.map((l) => l.artboard)).toEqual(['P']);
    expect(reg.get(w.runId)?.copyOf).toBeUndefined();
  });

  test('race: the holder finishes WHILE the copy is written → the copy wins, P goes to the next in line', async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { reg, copy, ask, abs } = setup({
      copyOnDisk: async (...args) => {
        await gate;
        return copyArtboard(...args);
      },
    });
    const busy = await ask('c1');
    await reg.started(busy.runId);
    const w = await ask('c2');
    const third = await ask('c3');
    const pending = copy(w.runId);
    await tick();
    await reg.turnEnded(busy.runId, 'done'); // the holder ends mid-copy: the old ticket is granted
    await tick();
    const mid = reg.get(w.runId) as RunRecord;
    expect(mid.state).toBe('waiting'); // never started on P
    expect(mid.leases).toEqual([]);
    release();
    const res = await pending;
    expect(res.status).toBe(200);
    await tick();
    const run = reg.get(w.runId) as RunRecord;
    expect(run.leases.map((l) => l.artboard)).toEqual([res.body.copy.artboard]);
    expect(run.state).not.toBe('waiting');
    // exactly one outcome: P went on down the line, the copy exists once
    expect(reg.get(third.runId)?.leases.map((l) => l.artboard)).toEqual(['P']);
    expect(artboardIds(readFileSync(abs, 'utf8'))).toEqual(['P', res.body.copy.artboard, 'S']);
  });

  test('a failed write puts the ask back in its place — it is still waiting, nothing was lost', async () => {
    const { reg, copy, ask, abs } = setup({
      copyOnDisk: async () => {
        throw new Error('disk full');
      },
    });
    await reg.started((await ask('c1')).runId);
    const w = await ask('c2', 'Headline in one word');
    const before = reg.get(w.runId) as RunRecord;
    const res = await copy(w.runId);
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('copy-failed');
    const after = reg.get(w.runId) as RunRecord;
    expect(after.state).toBe('waiting');
    expect(after.scope).toEqual(before.scope);
    expect(after.waiting.map((x) => x.artboard)).toEqual(['P']);
    expect(after.copyOf).toBeUndefined();
    expect(artboardIds(readFileSync(abs, 'utf8'))).toEqual(['P', 'S']);
  });

  test('refusals: not a run id 400, unknown 404, a running ask 409, main origin only, read-only refused', async () => {
    const { reg, copy, ask, specs } = setup();
    const r = await ask('c1');
    await reg.started(r.runId);
    expect((await copy(r.runId)).status).toBe(409);
    expect((await copy('r_nosuchrun1')).status).toBe(404);
    const m = matchRoute(specs, 'POST', '/_api/ai/runs/nope/copy');
    expect(m?.spec).toMatchObject({ origin: 'main', readOnly: 'refused' });
    const res = await m?.spec.handle(
      new Request('http://localhost/_api/ai/runs/nope/copy', { method: 'POST' }),
      m.params
    );
    expect(res?.status).toBe(400);
  });
});

describe('the copy is the waiting run’s write, in the run’s own stage (V2-1.5 §5.5)', () => {
  test('the chat tracker’s later begin joins the stage the copy opened; the busy run never owns the copy', async () => {
    const { createActionStage } = await import('../sync/action-stage.ts');
    const dir = mkdtempSync(path.join(tmpdir(), 'ai-copy-stage-'));
    dirs.push(dir);
    const stage = createActionStage({
      designRoot: dir,
      propose: async () => ({ status: 'accepted' }) as never,
      newTransactionId: () => 'tx_1',
      log: { log() {}, warn() {} },
    });
    // the busy run holds the canvas (it claimed the slug)
    const busy = 'r_busy00000001';
    stage.begin(busy, 'Claude: Make it greener', { runId: busy });
    stage.claim(busy, 'ui-c', null);
    // what routes/ai.ts does before the copy lands (stageOf → the waiting run's own id)
    const w = 'r_wait00000001';
    const copyBytes = 'export default () => null; // with the copy';
    stage.begin(w, 'Claude: Headline in one word', { runId: w, chatId: 'c2' });
    stage.claim(w, 'ui-c', hashBytes(copyBytes));
    // then the chat's own turn (acp/index.ts tracker): `acp:<chat>` with {runId} joins it
    stage.begin('acp:c2', 'Claude: Headline in one word', { runId: w, chatId: 'c2' });
    expect(
      stage
        .runs()
        .map((r) => r.runId)
        .sort()
    ).toEqual([busy, w].sort());
    // the watcher's import of the copy is staged by the WAITING run (matched by hash)
    expect(stage.captures('ui-c', true, copyBytes)).toBe(true);
    void stage.capture('ui-c', 'doc-ui-c', {
      lane: 'html',
      content: copyBytes,
      baseContent: 'export default () => null;',
      transactionId: 'tx_w1',
      stageable: true,
    } as never);
    await tick();
    expect(stage.runs().find((r) => r.runId === w)?.canvases).toEqual(['ui-c']);
    expect(stage.runs().find((r) => r.runId === busy)?.canvases).toEqual([]);
  });
});
