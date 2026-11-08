// T7.3b (#113 follow-up) — ⌘Z names the gesture. A person's annotation op batch may carry the
// gesture's own words (`label`: "Ticked “Write the post”", annotations/checklist-ops.ts) from the
// canvas to the op log, so the ⌘Z toast reads "Undone — Ticked “Write the post”" instead of the
// lane's fixed "Edit annotations". The label is untrusted client text: control and format
// characters go, it is capped at 80 characters, and it is only ever text. No label → the lane label.
// An AI run's batch keeps its run's label (the label rides only a person's batch).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import type { Subprocess } from 'bun';

import { cleanGestureLabel, MAX_GESTURE_LABEL, type Op } from '../annotations/ops.ts';
import { writeReplica } from '../annotations/replica.ts';
import { serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { draftWriteId } from '../annotations/ui/text-session.ts';
import { createApi } from '../api.ts';
import { createUndoProjection } from '../client/v2/undo/use-undo-projection.jsx';
import { createRegistry } from '../collab/registry.ts';
import type { RoomCallbacks } from '../collab/room.ts';
import { type Context, createBus } from '../context.ts';
import { createProjectUndoRoutes } from '../routes/project-undo.ts';
import { createAcceptedLink } from '../sync/accepted-link.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';
import type { TransactionClient } from '../sync/transaction-client.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const TICK = 'Ticked “Write the post”';
const AT = '2026-11-08T10:00:00.000Z';
const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const sticky = (id: string, text: string, index = 'a0'): AnnotationElement =>
  ({ id, type: 'sticky', index, x: 0, y: 0, w: 200, h: 200, text }) as AnnotationElement;
const item = (id: string, text: string, done?: boolean): AnnotationElement =>
  ({
    id,
    type: 'checkitem',
    index: 'a0',
    list: 's1',
    text,
    ...(done ? { done: { by: 'Me', at: AT } } : {}),
  }) as unknown as AnnotationElement;

describe('cleanGestureLabel — untrusted client text', () => {
  test('a plain gesture label passes as it is', () => {
    expect(cleanGestureLabel(TICK)).toBe(TICK);
  });
  test('not a string, empty or only blanks → no label (the lane label stands)', () => {
    for (const v of [undefined, null, 42, {}, ['x'], '', '   ', '\u0000\u0007'])
      expect(cleanGestureLabel(v)).toBeUndefined();
  });
  test('control, bidi and zero-width characters go; runs of blanks become one space', () => {
    expect(cleanGestureLabel('Ticked\u0000 \u202e“evil”\u202c\n\tnow\u200b\u2028x\u007f')).toBe(
      'Ticked “evil” now x'
    );
  });
  test('capped at 80 characters (code points), ending with an ellipsis', () => {
    const long = `Ticked “${'😀'.repeat(200)}”`;
    const out = cleanGestureLabel(long) as string;
    expect([...out].length).toBe(MAX_GESTURE_LABEL);
    expect(out.endsWith('…')).toBe(true);
    expect(cleanGestureLabel('x'.repeat(80))).toBe('x'.repeat(80));
  });
  test('a lone surrogate never survives the cap', () => {
    expect(cleanGestureLabel('a\ud800b')).toBe('a b');
  });
  test('markup stays inert text (rendered as text, never HTML)', () => {
    expect(cleanGestureLabel('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });
});

/* -------------------------------------------------------------- local home */

const REL = 'ui/k.tsx';
const REPO_REL = `.design/${REL}`;
const SLUG = 'ui-k';
const CANVAS = `import { DCArtboard } from '@maude/canvas-lib';
export default function K() {
  return <DCArtboard id="p" width={100} height={100}><p>k</p></DCArtboard>;
}
`;

function project() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-t73b-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  writeFileSync(path.join(designRoot, REL), CANVAS);
  const boardFile = path.join(designRoot, `${SLUG}.annotations.json`);
  writeFileSync(boardFile, serializeBoard([sticky('s1', 'Launch'), item('c1', 'Write the post')]));
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

/** server.ts onAnnotationsChanged → runtime.proposeLane, as the disk path and a room projection deliver it. */
async function stroke(
  h: LocalHome,
  p: ReturnType<typeof project>,
  els: AnnotationElement[],
  how: { label?: unknown; draft?: boolean } = {}
) {
  const base = p.board();
  h.runtime.proposeLane(SLUG, 'annotations', serializeBoard(els), {
    baseText: base,
    ...(how.draft ? { draft: true } : {}),
    ...(how.label !== undefined ? { label: how.label as string } : {}),
  });
  p.writeBoard(els);
  await h.flush();
}

const topRow = async (h: LocalHome) =>
  (await h.runtime.acceptedHistory({ path: REPO_REL, limit: 50, mine: true }))[0] as {
    kind: string;
    label: string;
  };

describe('local home — the row (and so the ⌘Z toast) names the gesture', () => {
  test('a tick with its label is recorded under that label', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    await stroke(h, p, [sticky('s1', 'Launch'), item('c1', 'Write the post', true)], {
      label: TICK,
    });
    const top = await topRow(h);
    expect([top.kind, top.label]).toEqual(['edit', TICK]);
  });

  test('no label → the lane label, as before', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    await stroke(h, p, [sticky('s1', 'Launch'), item('c1', 'Write the post', true)]);
    expect((await topRow(h)).label).toBe('Edit annotations');
  });

  test('a hostile label is cleaned at the home too (defence in depth)', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    await stroke(h, p, [sticky('s1', 'Launch'), item('c1', 'Write the post', true)], {
      label: `Ticked\u202e\u0000 ${'x'.repeat(300)}`,
    });
    const label = (await topRow(h)).label;
    expect(label.startsWith('Ticked x')).toBe(true);
    expect([...label].length).toBe(MAX_GESTURE_LABEL);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting none survived
    expect(/[\u0000-\u001f\u202e]/.test(label)).toBe(false);
  });

  test('a text session (drafts, then the commit) takes the commit’s label', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    await stroke(h, p, [sticky('s1', 'Launch'), item('c1', 'Write the p')], { draft: true });
    await stroke(h, p, [sticky('s1', 'Launch'), item('c1', 'Write the pitch')], {
      label: 'Edited an item',
    });
    expect((await topRow(h)).label).toBe('Edited an item');
  });
});

/* --------------------------------------------------------------- api.ts */

const FILE = '.design/ui/Site.tsx';
function apiRig(live: boolean) {
  const { root, designRoot } = makeSandbox();
  dirs.push(root);
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(join(designRoot, 'ui/Site.tsx'), 'export default function P(){return <main/>}');
  writeFileSync(
    join(designRoot, 'ui-site.annotations.json'),
    serializeBoard([sticky('s1', 'Launch'), item('c1', 'Write the post')])
  );
  const ctx: Context = {
    cfg: {} as Context['cfg'],
    projectLabel: 't73b',
    bus: createBus(),
    paths: {
      repoRoot: root,
      designRel: '.design',
      designRoot,
      serverInfoFile: join(designRoot, '_server.json'),
      activeFile: join(designRoot, '_active.json'),
      commentsDir: join(designRoot, '_comments'),
      canvasStateDir: join(designRoot, '_canvas-state'),
      historyDir: join(designRoot, '_history'),
      tokensUrlRel: '',
      systemDirRel: 'system',
    },
  };
  const hook: Array<string | undefined> = [];
  const room: Array<string | undefined> = [];
  const api = createApi(ctx, {
    onCommentsChanged() {},
    onAnnotationsChanged(_f, _t, _w, _b, _l, _c, label) {
      hook.push(label);
    },
    applyAnnotationOpsLive: (_f, ops, _id, _g, label) => {
      if (!live) return null;
      room.push(label);
      return { state: new Map(), touched: new Set(['c1']), rejected: [], inverse: ops as Op[] };
    },
  });
  return { api, hook, room };
}
const tick: Op = { op: 'patch', id: 'c1', set: { done: { by: 'Me', at: AT } } } as Op;

describe('api.applyAnnotationOps — the label reaches both paths', () => {
  test('disk path: onAnnotationsChanged gets the label', async () => {
    const { api, hook } = apiRig(false);
    const r = await api.applyAnnotationOps(FILE, [tick], undefined, { label: TICK });
    expect(r.ok).toBe(true);
    expect(hook).toEqual([TICK]);
  });
  test('live room path: the room gets the label', async () => {
    const { api, room, hook } = apiRig(true);
    await api.applyAnnotationOps(FILE, [tick], undefined, { label: TICK });
    expect(room).toEqual([TICK]);
    expect(hook).toEqual([]);
  });
  test('a run-tagged batch never carries a person’s label', async () => {
    const { api, hook } = apiRig(false);
    await api.applyAnnotationOps(FILE, [tick], 'run:r_x', { label: TICK });
    expect(hook).toEqual([undefined]);
  });
});

/* ------------------------------------------------------------ collab room */

describe('room — a projection carries the label of the one gesture it flushes', () => {
  const callbacks = (): RoomCallbacks => ({
    async seed() {},
    async persistJson() {},
    async persistBinary() {},
  });
  const roomWith = (els: AnnotationElement[]) => {
    const registry = createRegistry(callbacks());
    writeReplica(registry.get(SLUG).doc, els);
    return registry;
  };
  const els = () => [sticky('s1', 'Launch'), item('c1', 'Write the post')];

  test('one labelled batch → its label; taken, the next flush starts clean', () => {
    const r = roomWith(els());
    r.applyOpsToRoom(SLUG, [tick], crypto.randomUUID(), undefined, TICK);
    expect(r.takeFlushLabel(SLUG)).toBe(TICK);
    expect(r.takeFlushLabel(SLUG)).toBeUndefined();
  });
  test('two gestures with different labels in one flush → no label (the lane label)', () => {
    const r = roomWith(els());
    r.applyOpsToRoom(SLUG, [tick], crypto.randomUUID(), undefined, TICK);
    r.applyOpsToRoom(
      SLUG,
      [{ op: 'patch', id: 's1', set: { text: 'Go' } } as Op],
      crypto.randomUUID(),
      undefined,
      'Edited an item'
    );
    expect(r.takeFlushLabel(SLUG)).toBeUndefined();
  });
  test('an unlabelled batch beside a labelled one → no label', () => {
    const r = roomWith(els());
    r.applyOpsToRoom(SLUG, [tick], crypto.randomUUID(), undefined, TICK);
    r.applyOpsToRoom(SLUG, [{ op: 'patch', id: 's1', set: { text: 'Go' } } as Op]);
    expect(r.takeFlushLabel(SLUG)).toBeUndefined();
  });
  test('a draft beside the labelled commit does not blur the label', () => {
    const r = roomWith(els());
    r.applyOpsToRoom(
      SLUG,
      [{ op: 'patch', id: 's1', set: { text: 'L' } } as Op],
      draftWriteId(),
      undefined
    );
    r.applyOpsToRoom(SLUG, [tick], crypto.randomUUID(), undefined, TICK);
    expect(r.takeFlushLabel(SLUG)).toBe(TICK);
  });
});

/* ------------------------------------------------------------- hub link */

describe('hub link — the annotations edit goes out under the gesture’s label (v1 hubs read it as any label)', () => {
  function rig() {
    const designRoot = mkdtempSync(path.join(tmpdir(), 'maude-t73b-link-'));
    dirs.push(designRoot);
    const sent: Array<{ kind: string; label: string }> = [];
    const client = {
      newTransactionId: () => `tx_${sent.length + 1}`,
      bootstrap: async () => ({ mode: 'transactions' }),
      propose: async (a: { kind: string; label: string; transactionId?: string }) => {
        sent.push(a);
        return {
          protocol: 1,
          status: 'accepted',
          transactionId: a.transactionId,
          actionId: `act_${sent.length}`,
        };
      },
      read: async () => ({}),
      reserve: () => ({ transactionId: 'tx_r', createdAt: 1 }),
      entryFile: () => path.join(designRoot, 'none'),
      stop() {},
    } as unknown as TransactionClient;
    const l = createAcceptedLink({
      hubUrl: 'https://hub.test',
      token: () => 't',
      designRoot,
      docNameFor: (s) => `doc:${s}`,
      client,
      log: { log() {}, warn() {}, error() {} },
    });
    return { l, sent };
  }
  const p = (label?: string) => ({
    lane: 'annotations' as const,
    content: '{"v":2,"elements":[1]}',
    baseContent: '{"v":2,"elements":[]}',
    transactionId: 'tx_one',
    ...(label !== undefined ? { label } : {}),
  });

  test('labelled → that label; cleaned; unlabelled → "Edit annotations"', async () => {
    const { l, sent } = rig();
    const lane = l.laneLink('ui-a');
    await lane.propose(p(TICK));
    await lane.propose(p('\u202eTicked\u0000 x'));
    await lane.propose(p());
    l.stop();
    expect(sent.map((s) => [s.kind, s.label])).toEqual([
      ['edit', TICK],
      ['edit', 'Ticked x'],
      ['edit', 'Edit annotations'],
    ]);
  });
});

/* ------------------------------------------------- the ⌘Z toast (client) */

describe('the ⌘Z toast says the gesture', () => {
  test('tick on a local project, then ⌘Z → "Undone — Ticked “Write the post”"', async () => {
    const p = project();
    const h = open(p.designRoot);
    await h.ready();
    await stroke(h, p, [sticky('s1', 'Launch'), item('c1', 'Write the post', true)], {
      label: TICK,
    });
    const specs = createProjectUndoRoutes({
      control: () => h.runtime as never,
      designRel: '.design',
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
    const said: string[] = [];
    const store = createUndoProjection({
      request,
      now: () => 0,
      announce: (m: string) => said.push(m),
      designRel: () => '.design',
      ownRunOn: () => false,
    } as never);
    await store.open(REPO_REL);
    const r = (await store.undo(REPO_REL)) as { ok?: boolean };
    expect(r.ok).toBe(true);
    expect(said).toEqual([`Undone — ${TICK}`]);
  });
});

describe('the canvas sends the checklist gesture’s words with its batch', () => {
  const src = readFileSync(join(import.meta.dir, '..', 'annotations-layer.tsx'), 'utf8');
  test('commitChecklist hands res.label to the op batch, and the POST body carries it', () => {
    const commit = src.slice(src.indexOf('const commitChecklist = useCallback('));
    expect(commit.slice(0, 800)).toContain('applyOpsLocal(ops, undefined, res.label)');
    expect(src).toContain('void sendOps(ops, true, false, sid, label);');
    expect(src).toContain(
      'body: JSON.stringify({ file, actionId, ops, ...(label ? { label } : {}) })'
    );
  });
});

/* -------------------------------------- end to end: POST /_api/annotations/ops */

describe('POST /_api/annotations/ops — the label lands in history (local project)', () => {
  let root = '';
  let designRoot = '';
  let proc: Subprocess | null = null;
  let base = '';
  const CFILE = '.design/ui/card.tsx';
  beforeAll(async () => {
    ({ root, designRoot } = makeSandbox());
    writeFileSync(
      join(designRoot, 'ui', 'card.tsx'),
      `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';\nexport default function C(){return <DesignCanvas><DCArtboard id="a" width={100} height={100}><p>c</p></DCArtboard></DesignCanvas>;}\n`
    );
    writeFileSync(
      join(designRoot, 'ui-card.annotations.json'),
      serializeBoard([
        sticky('s1', 'Launch'),
        item('c1', 'Write the post'),
        item('c2', 'Record the demo'),
      ])
    );
    const port = nextPort();
    proc = await bootServer(root, port, {
      MAUDE_NO_AUTOBUILD: '1',
      XDG_CONFIG_HOME: join(root, '.config'),
    });
    base = `http://localhost:${port}`;
    for (let i = 0; i < 80; i++) {
      const h = (await (await fetch(`${base}/_api/project/history`)).json()) as {
        ok: boolean;
        history?: unknown[];
      };
      if (h.ok && (h.history?.length ?? 0) > 0) break;
      await Bun.sleep(100);
    }
  }, 40_000);
  afterAll(async () => {
    if (proc) await killProc(proc);
    rmSync(root, { recursive: true, force: true });
  });

  const post = (body: unknown) =>
    fetch(`${base}/_api/annotations/ops`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify(body),
    });
  const top = async () => {
    for (let i = 0; i < 40; i++) {
      const h = (await (
        await fetch(`${base}/_api/project/history?path=${encodeURIComponent(CFILE)}`)
      ).json()) as { history: { kind: string; label: string }[] };
      const row = h.history?.find((r) => r.kind === 'edit');
      if (row) return { row, all: h.history };
      await Bun.sleep(50);
    }
    return { row: null, all: [] };
  };
  const tickOp = (id: string) => ({ op: 'patch', id, set: { done: { by: 'Me', at: AT } } });

  test('a tick with its label → the edit row says the gesture', async () => {
    const r = await post({
      file: CFILE,
      actionId: crypto.randomUUID(),
      ops: [tickOp('c1')],
      label: TICK,
    });
    expect(r.status).toBe(200);
    expect((await top()).row?.label).toBe(TICK);
  });

  test('a hostile label is cleaned; a batch with none falls back to "Edit annotations"', async () => {
    await post({
      file: CFILE,
      actionId: crypto.randomUUID(),
      ops: [tickOp('c2')],
      label: `\u202eTicked\u0000 “Record the demo”${'!'.repeat(200)}`,
    });
    const hostile = (await top()).row?.label ?? '';
    expect(hostile.startsWith('Ticked “Record the demo”')).toBe(true);
    expect([...hostile].length).toBe(MAX_GESTURE_LABEL);
    const r = await post({
      file: CFILE,
      actionId: crypto.randomUUID(),
      ops: [{ op: 'patch', id: 's1', set: { text: 'Go' } }],
      label: 42,
    });
    expect(r.status).toBe(200);
    for (let i = 0; i < 40; i++) {
      if ((await top()).row?.label === 'Edit annotations') break;
      await Bun.sleep(50);
    }
    expect((await top()).row?.label).toBe('Edit annotations');
  });
});
