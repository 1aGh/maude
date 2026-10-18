// S2.9b — the `annotations` rider on `PATCH /_api/canvas-meta` (contract
// client/v2/contracts/S2-S4-artboard-motion-ids.md §2): an artboard move and the
// moves of the annotations bound to it are ONE project action, so one ⌘Z puts
// the artboard AND its sticky back.
//
//   - the move-delta rule (pure): members by exactly their artboard's delta,
//     bound arrows' caches only, `expect` on every field; anything else refused;
//   - the api over an accepted-mode home: ONE proposal with the `meta` and the
//     `annotations` lane, the bus's undoGroup as its write id, files written
//     raw (no per-lane hooks); a refused proposal writes nothing;
//   - the local home (a real studio): one action, ⌘Z restores both files byte
//     for byte; a refused rider writes nothing; the canvas origin is held to
//     the same rule;
//   - Can comment (a hub-linked desktop vouched `viewer`): 403, nothing written.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { canonicalAnnotations } from '../annotations/board-text.ts';
import type { Op } from '../annotations/ops.ts';
import { parseBoard, serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { createApi, type LaneChange } from '../api.ts';
import { type Context, createBus } from '../context.ts';
import { parseRider, positionsOf, riderPatch, riderRefusal } from '../routes/canvas-meta-rider.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const sticky = (over: Record<string, unknown> = {}) =>
  ({
    id: 's_hero',
    type: 'sticky',
    index: 'a0',
    x: 100,
    y: 120,
    w: 200,
    h: 200,
    text: 'Make the hero bigger',
    parentArtboard: 'desktop',
    ...over,
  }) as AnnotationElement;
const loose = () =>
  sticky({ id: 's_loose', index: 'a1', x: 2000, y: 2000, parentArtboard: undefined });
const arrow = () =>
  ({
    id: 'a_to_hero',
    type: 'arrow',
    index: 'a2',
    start: { x: 1500, y: 300 },
    end: { x: 640, y: 300 },
    endHost: { ref: 'ab:desktop', label: 'Desktop', box: { x: 0, y: 0, w: 640, h: 480 } },
  }) as unknown as AnnotationElement;
const board = (els: AnnotationElement[]) => canonicalAnnotations(serializeBoard(els)) as string;
const layout = (x: number, y = 0) => ({
  artboards: [
    { id: 'desktop', x, y },
    { id: 'mobile', x: 800, y: 0 },
  ],
});
const moveHero = (dx: number, dy = 0): Op => ({
  op: 'patch',
  id: 's_hero',
  set: { x: 100 + dx, y: 120 + dy },
  expect: { x: 100, y: 120 },
});

/* ------------------------------------------------------- the move-delta rule */

describe('the move-delta rule', () => {
  const before = positionsOf(layout(0));
  const after = positionsOf(layout(300, 40));
  const els = [sticky(), loose(), arrow()];
  const reason = (ops: Op[], b = before, a = after) =>
    riderRefusal(els, ops, b, a)?.body.reason ?? null;

  test('a member shifted by exactly its artboard’s delta passes; any other shift is not a move', () => {
    expect(reason([moveHero(300, 40)])).toBeNull();
    expect(reason([moveHero(300.3, 40)])).toBeNull(); // within the tolerance
    expect(reason([moveHero(310, 40)])).toBe('not-a-move');
    expect(reason([moveHero(300, 0)])).toBe('not-a-move');
  });

  test('a loose note, a put, a delete, an unset or another field is refused', () => {
    const looseMove: Op = { op: 'patch', id: 's_loose', set: { x: 2300 }, expect: { x: 2000 } };
    expect(reason([looseMove])).toBe('not-a-move');
    expect(reason([{ op: 'delete', id: 's_hero' }])).toBe('not-a-move');
    expect(reason([{ op: 'put', el: sticky({ id: 'new' }) }])).toBe('not-a-move');
    const text: Op = {
      op: 'patch',
      id: 's_hero',
      set: { text: 'x' },
      expect: { text: 'Make the hero bigger' },
    };
    expect(reason([text])).toBe('not-a-move');
    expect(reason([{ op: 'patch', id: 's_hero', unset: ['text'] }])).toBe('not-a-move');
    // no `expect` → the legacy ⌘Z could not invert it
    expect(reason([{ op: 'patch', id: 's_hero', set: { x: 400, y: 160 } }])).toBe('not-a-move');
  });

  test('a stale expect is 409 stale; a gone id is 409 gone', () => {
    const stale: Op = {
      op: 'patch',
      id: 's_hero',
      set: { x: 400, y: 160 },
      expect: { x: 99, y: 120 },
    };
    expect(riderRefusal(els, [stale], before, after)?.status).toBe(409);
    expect(reason([stale])).toBe('stale');
    expect(reason([{ ...moveHero(300, 40), id: 'nope' } as Op])).toBe('gone');
  });

  test('an artboard that did not move carries no members', () => {
    expect(reason([moveHero(300, 40)], before, before)).toBe('not-a-move');
  });

  test('a bound arrow may refresh its cached free points and the bind’s box, nothing else', () => {
    const cache: Op = {
      op: 'patch',
      id: 'a_to_hero',
      set: {
        end: { x: 940, y: 340 },
        endHost: { ref: 'ab:desktop', label: 'Desktop', box: { x: 300, y: 40, w: 640, h: 480 } },
      },
      expect: { end: { x: 640, y: 300 }, endHost: arrow().endHost },
    };
    expect(reason([moveHero(300, 40), cache])).toBeNull();
    const rebind: Op = {
      op: 'patch',
      id: 'a_to_hero',
      set: { endHost: { ref: 'ab:mobile', label: 'Mobile' } },
      expect: { endHost: arrow().endHost },
    };
    expect(reason([rebind])).toBe('not-a-move');
    const bindToElement: Op = {
      op: 'patch',
      id: 'a_to_hero',
      set: { end: { el: 's_loose' } },
      expect: { end: { x: 640, y: 300 } },
    };
    expect(reason([bindToElement])).toBe('not-a-move');
  });

  test('a JSX-placed artboard (no meta position yet): its members move by one rigid delta', () => {
    const two = [sticky(), sticky({ id: 's_two', index: 'a3', x: 10, y: 10 })];
    const second = (dx: number): Op => ({
      op: 'patch',
      id: 's_two',
      set: { x: 10 + dx, y: 10 },
      expect: { x: 10, y: 10 },
    });
    const none = new Map<string, { x: number; y: number }>();
    expect(riderRefusal(two, [moveHero(50), second(50)], none, after)).toBeNull();
    expect(riderRefusal(two, [moveHero(50), second(90)], none, after)?.body.reason).toBe(
      'not-a-move'
    );
  });

  test('the wire: a dropped op refuses the batch; the action id is the bus’s undoGroup grammar', () => {
    expect('status' in parseRider({ ops: [{ op: 'nope' }], actionId: 'ab-move-1' })).toBe(true);
    expect('status' in parseRider({ ops: [], actionId: 'has space' })).toBe(true);
    const ok = parseRider({ ops: [moveHero(1)], actionId: 'ab-move-1', label: 'Tidy\u0007 up' });
    expect('status' in ok ? null : ok.label).toBe('Tidy up');
  });
});

/* --------------------------------------------------- an accepted-mode home */

function ctxFor(repoRoot: string): Context {
  const designRoot = join(repoRoot, '.design');
  return {
    cfg: {
      designRoot: '.design',
      canvasGroups: [{ label: 'UI', path: 'ui' }],
      _source: 'defaults',
    },
    projectLabel: 'test',
    paths: {
      repoRoot,
      designRel: '.design',
      designRoot,
      serverInfoFile: join(designRoot, '_server.json'),
      activeFile: join(designRoot, '_active.json'),
      commentsDir: join(designRoot, '_comments'),
      canvasStateDir: join(designRoot, '_canvas-state'),
      historyDir: join(designRoot, '_history'),
      tokensUrlRel: '.design/system/colors.css',
      systemDirRel: 'system',
    },
    bus: createBus(),
  } as unknown as Context;
}

describe('an accepted-mode home — ONE proposal, both lanes', () => {
  const FILE = '.design/ui/card.tsx';
  let root = '';
  const metaPath = () => join(root, '.design', 'ui', 'card.meta.json');
  const boardPath = () => join(root, '.design', 'ui-card.annotations.json');

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'canvas-meta-rider-'));
    mkdirSync(join(root, '.design', 'ui'), { recursive: true });
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  const seed = () => {
    writeFileSync(join(root, '.design', 'ui', 'card.tsx'), 'export default () => <main/>;\n');
    writeFileSync(metaPath(), `${JSON.stringify({ title: 'Card', layout: layout(0) }, null, 2)}\n`);
    writeFileSync(boardPath(), board([sticky(), loose()]));
  };

  const run = async (answer: {
    status: 'accepted' | 'rejected';
    code?: string;
    actionId?: string;
  }) => {
    seed();
    const sent: Array<{ slug: string; lanes: LaneChange[]; o: Record<string, unknown> }> = [];
    const hooks: string[] = [];
    const api = createApi(ctxFor(root), {
      onCommentsChanged: () => {},
      onMetaChanged: () => void hooks.push('meta'),
      onAnnotationsChanged: () => void hooks.push('annotations'),
    });
    const control = () => ({
      acceptedMode: () => true,
      proposeLanes: (slug: string, lanes: LaneChange[], o: Record<string, unknown>) => {
        sent.push({ slug, lanes, o });
        return Promise.resolve(answer);
      },
    });
    const res = await riderPatch(
      { api, control },
      {
        file: FILE,
        patch: { layout: layout(300, 40) },
        annotations: {
          ops: [moveHero(300, 40)],
          actionId: 'ab-move-k3j9x0abcd',
          label: 'Move 1 artboard',
        },
      }
    );
    return { res, sent, hooks };
  };

  test('one proposal carries meta + annotations under the undoGroup; files are written raw', async () => {
    const { res, sent, hooks } = await run({ status: 'accepted', actionId: 'act_1' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { actionId?: string }).actionId).toBe('act_1');
    expect(sent.length).toBe(1);
    expect(sent[0]?.slug).toBe('ui-card');
    expect(sent[0]?.lanes.map((l) => l.lane)).toEqual(['meta', 'annotations']);
    expect(sent[0]?.o).toMatchObject({
      kind: 'edit',
      label: 'Move 1 artboard',
      writeId: 'ab-move-k3j9x0abcd',
    });
    expect(hooks).toEqual([]);
    const meta = JSON.parse(readFileSync(metaPath(), 'utf8'));
    expect(meta.layout.artboards[0]).toEqual({ id: 'desktop', x: 300, y: 40 });
    const hero = parseBoard(readFileSync(boardPath(), 'utf8')).elements.find(
      (e) => e.id === 's_hero'
    );
    expect([hero?.x, hero?.y]).toEqual([400, 160]);
  });

  test('a refused proposal writes neither file', async () => {
    const before = () => [readFileSync(metaPath(), 'utf8'), readFileSync(boardPath(), 'utf8')];
    seed();
    const was = before();
    const { res } = await run({ status: 'rejected', code: 'conflict' });
    expect(res.status).toBe(409);
    expect(before()).toEqual(was);
  });
});

/* -------------------------------------------------------- the local home */

async function readCanvasOrigin(designRoot: string): Promise<string> {
  for (let i = 0; i < 80; i++) {
    try {
      const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8'));
      if (info.canvasOrigin) return info.canvasOrigin as string;
    } catch {
      /* not written yet */
    }
    await Bun.sleep(50);
  }
  throw new Error('canvasOrigin never appeared in _server.json');
}

describe('the local home — one action, one ⌘Z for an artboard and its sticky', () => {
  let root = '';
  let designRoot = '';
  let proc: Subprocess | null = null;
  let base = '';
  let canvas = '';
  const FILE = '.design/ui/card.tsx';
  const metaPath = () => join(designRoot, 'ui', 'card.meta.json');
  const boardPath = () => join(designRoot, 'ui-card.annotations.json');
  const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
  const files = () => ({ meta: read(metaPath()), board: read(boardPath()) });

  const patch = async (origin: string, body: unknown) => {
    const r = await fetch(`${origin}/_api/canvas-meta`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify(body),
    });
    return {
      status: r.status,
      json: (await r.json().catch(() => ({}))) as Record<string, unknown>,
    };
  };
  const move = (
    x: number,
    y: number,
    ops: Op[],
    actionId = `ab-move-${Date.now().toString(36)}`
  ) => ({
    file: FILE,
    patch: { layout: layout(x, y) },
    annotations: { ops, actionId, label: 'Move 1 artboard' },
  });

  beforeAll(async () => {
    ({ root, designRoot } = makeSandbox());
    writeFileSync(join(designRoot, 'ui', 'card.tsx'), 'export default () => <main/>;\n');
    writeFileSync(metaPath(), `${JSON.stringify({ title: 'Card', layout: layout(0) }, null, 2)}\n`);
    writeFileSync(boardPath(), board([sticky(), loose()]));
    const port = nextPort();
    proc = await bootServer(root, port, {
      MAUDE_NO_AUTOBUILD: '1',
      MAUDE_CANVAS_ORIGIN_SPLIT: '1',
      XDG_CONFIG_HOME: join(root, '.config'),
    });
    base = `http://localhost:${port}`;
    canvas = await readCanvasOrigin(designRoot);
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

  test('the move is ONE action over meta + board, and ⌘Z puts the artboard and its sticky back byte for byte', async () => {
    const before = files();
    const history = async () =>
      (
        (await (
          await fetch(`${base}/_api/project/history?path=${encodeURIComponent(FILE)}`)
        ).json()) as { history: { actionId: string; kind: string; label: string }[] }
      ).history;
    const r = await patch(canvas, move(300, 40, [moveHero(300, 40)]));
    expect(r.status).toBe(200);
    expect(typeof r.json.actionId).toBe('string');
    expect(JSON.parse(read(metaPath()) ?? '{}').layout.artboards[0]).toEqual({
      id: 'desktop',
      x: 300,
      y: 40,
    });
    const hero = parseBoard(read(boardPath()) ?? '').elements.find((e) => e.id === 's_hero');
    expect([hero?.x, hero?.y]).toEqual([400, 160]);

    // Past the watcher's debounce: the meta write it saw must not be recorded a second time.
    await Bun.sleep(1500);
    const rows = await history();
    expect(rows[0]).toMatchObject({
      actionId: r.json.actionId,
      kind: 'edit',
      label: 'Move 1 artboard',
    });
    // one record for the gesture — not a layout row plus a board row
    // ⌘Z sees ONE entry for the gesture (the store's `outside` catch-up of the unwatched board
    // is not an entry — V2-1.5 §5.3 membership).
    const stack = (await (
      await fetch(`${base}/_api/project/undo-stack?canvas=${encodeURIComponent(FILE)}&since=0`)
    ).json()) as { entries: { actionId: string }[] };
    expect(stack.entries.map((e) => e.actionId)).toEqual([r.json.actionId as string]);
    expect(rows.filter((x) => x.kind === 'edit').length).toBe(1);

    const undo = await fetch(`${base}/_api/project/undo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ actionId: r.json.actionId }),
    });
    expect(undo.status).toBe(200);
    expect(read(boardPath())).toBe(before.board);
    expect(JSON.parse(read(metaPath()) ?? '{}').layout).toEqual(
      JSON.parse(before.meta ?? '{}').layout
    );
  }, 30_000);

  test('a rider that is not the move delta refuses the whole PATCH, from either origin; nothing is written', async () => {
    const before = files();
    const looseMove: Op = {
      op: 'patch',
      id: 's_loose',
      set: { x: 0, y: 0 },
      expect: { x: 2000, y: 2000 },
    };
    for (const origin of [canvas, base]) {
      const r = await patch(origin, move(500, 0, [looseMove]));
      expect(`${r.status} ${r.json.reason}`).toBe('403 not-a-move');
      const del = await patch(origin, move(500, 0, [{ op: 'delete', id: 's_loose' }]));
      expect(`${del.status} ${del.json.reason}`).toBe('403 not-a-move');
      const stale = await patch(
        origin,
        move(500, 0, [{ ...moveHero(500), expect: { x: 1, y: 120 } } as Op])
      );
      expect(`${stale.status} ${stale.json.reason}`).toBe('409 stale');
    }
    expect(files()).toEqual(before);
  }, 30_000);
});

/* ------------------------------------------------------------ Can comment */

describe('Can comment (a hub-linked desktop vouched viewer)', () => {
  const HUB_URL = 'http://hub.invalid:9';
  let proc: Subprocess | null = null;
  let root = '';

  afterAll(async () => {
    if (proc) await killProc(proc);
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test('a move with a rider is refused 403 read-only; neither file changes', async () => {
    const sb = makeSandbox();
    root = sb.root;
    const cfgPath = join(sb.designRoot, 'config.json');
    const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
    cfg.linkedHub = { url: HUB_URL, linkedAt: Date.now() };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    writeFileSync(join(sb.designRoot, 'ui', 'card.tsx'), 'export default () => <main/>;\n');
    const metaPath = join(sb.designRoot, 'ui', 'card.meta.json');
    const boardPath = join(sb.designRoot, 'ui-card.annotations.json');
    writeFileSync(metaPath, `${JSON.stringify({ layout: layout(0) }, null, 2)}\n`);
    writeFileSync(boardPath, board([sticky()]));
    const hubsPath = join(root, 'hubs.json');
    writeFileSync(
      hubsPath,
      JSON.stringify({ hubs: { [HUB_URL]: { token: 't', linkedAt: Date.now(), role: 'viewer' } } })
    );
    const port = nextPort();
    proc = await bootServer(root, port, { HUBS_CONFIG_PATH: hubsPath, MAUDE_NO_AUTOBUILD: '1' });
    const base = `http://localhost:${port}`;
    const was = [readFileSync(metaPath, 'utf8'), readFileSync(boardPath, 'utf8')];
    const r = await fetch(`${base}/_api/canvas-meta`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({
        file: '.design/ui/card.tsx',
        patch: { layout: layout(300, 40) },
        annotations: { ops: [moveHero(300, 40)], actionId: 'ab-move-viewer01' },
      }),
    });
    expect(`${r.status} ${((await r.json()) as { error?: string }).error}`).toBe('403 read-only');
    expect([readFileSync(metaPath, 'utf8'), readFileSync(boardPath, 'utf8')]).toEqual(was);
  }, 30_000);
});
