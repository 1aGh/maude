// annotate-write — the AI whiteboard WRITE verb (`maude design annotate`,
// DDR-242 AD9). Drives bin/annotate.mjs as a subprocess against a temp design
// root and asserts the v2 board it leaves behind: canonical bytes, registry-
// valid elements, `author: {kind:'ai'}` on everything it created, and the
// element ops it sends to a live server.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Scene } from '../annotations/scene.ts';
import { canonical, parseBoard, serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';

const BIN = new URL('../bin/annotate.mjs', import.meta.url).pathname;
const READER = new URL('../bin/read-annotations.mjs', import.meta.url).pathname;

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'annotate-test-'));
  mkdirSync(join(root, '.design'), { recursive: true });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

interface Run {
  code: number;
  out: string;
  err: string;
}

function annotate(args: string[], stdin?: unknown): Run {
  const proc = Bun.spawnSync(['bun', BIN, ...args, '--root', root], {
    stdin:
      stdin === undefined
        ? undefined
        : new TextEncoder().encode(typeof stdin === 'string' ? stdin : JSON.stringify(stdin)),
  });
  return {
    code: proc.exitCode ?? 1,
    out: new TextDecoder().decode(proc.stdout),
    err: new TextDecoder().decode(proc.stderr),
  };
}

/** Async variant — the in-process stub server must keep serving while it runs. */
async function annotateAsync(
  args: string[],
  stdin: unknown,
  env: Record<string, string> = {}
): Promise<Run> {
  const proc = Bun.spawn(['bun', BIN, ...args, '--root', root], {
    env: { ...process.env, ...env },
    stdin: new TextEncoder().encode(JSON.stringify(stdin)),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out, err };
}

const pathOf = (slug: string) => join(root, '.design', `${slug}.annotations.json`);

function boardText(slug: string): string {
  const p = pathOf(slug);
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

function board(slug: string): AnnotationElement[] {
  const text = boardText(slug);
  return text ? parseBoard(text).elements : [];
}

function seed(slug: string, elements: Record<string, unknown>[]): void {
  writeFileSync(pathOf(slug), serializeBoard(elements.map((e) => canonical(e as never))));
}

function byId(slug: string): Record<string, AnnotationElement> {
  return Object.fromEntries(board(slug).map((e) => [e.id, e]));
}

function worldBox(slug: string, id: string) {
  return new Scene(board(slug)).worldBox(id);
}

/** Every write leaves canonical bytes that the registry accepts element-for-element. */
function expectCanonical(slug: string): void {
  const text = boardText(slug);
  const parsed = parseBoard(text);
  expect(parsed.dropped).toEqual([]);
  expect(serializeBoard(parsed.elements)).toBe(text);
}

function readGraph(rel: string) {
  const proc = Bun.spawnSync(['bun', READER, rel, '--root', root, '--graph']);
  return JSON.parse(new TextDecoder().decode(proc.stdout)) as {
    graph: { nodes: Array<{ text?: string }>; edges: unknown[] };
  };
}

describe('annotate --flow', () => {
  test('writes an auto-laid-out diagram of BOUND connectors, stamped ai', () => {
    writeFileSync(
      join(root, 'flow.json'),
      JSON.stringify({
        nodes: [
          { id: 'a', label: 'Start' },
          { id: 'b', label: 'Middle' },
          { id: 'c', label: 'End', shape: 'ellipse' },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'c', label: 'ships' },
        ],
      })
    );
    const res = annotate(['ui/Flow.tsx', '--flow', join(root, 'flow.json')]);
    expect(res.code).toBe(0);
    const result = JSON.parse(res.out);
    expect(result.ok).toBe(true);
    expect(result.via).toBe('file');
    expect(Object.keys(result.refs)).toEqual(['@a', '@b', '@c']);
    expectCanonical('ui-flow');
    const els = board('ui-flow');
    for (const e of els) expect(e.author).toEqual({ kind: 'ai' });
    const shapes = els.filter((e) => e.type === 'shape');
    expect(shapes.map((s) => (s.label as { text: string }).text).sort()).toEqual([
      'End',
      'Middle',
      'Start',
    ]);
    const c = byId('ui-flow')[result.refs['@c']];
    expect(c?.kind).toBe('ellipse');
    const arrows = els.filter((e) => e.type === 'arrow');
    expect(arrows).toHaveLength(2);
    for (const a of arrows) {
      expect(a.start).toHaveProperty('el');
      expect(a.end).toHaveProperty('el');
    }
    // The edge label is a text element; layered layout puts b right of a.
    expect(els.some((e) => e.type === 'text' && e.text === 'ships')).toBe(true);
    const ax = worldBox('ui-flow', result.refs['@a'])?.x ?? 0;
    const bx = worldBox('ui-flow', result.refs['@b'])?.x ?? 0;
    expect(bx).toBeGreaterThan(ax);
  });

  test('read-annotations --graph reads the diagram back as the same graph', () => {
    const parsed = readGraph('ui/Flow.tsx');
    expect(parsed.graph.edges).toHaveLength(2);
    expect(parsed.graph.nodes.map((n) => n.text).sort()).toEqual(['End', 'Middle', 'Start']);
  });
});

describe('annotate --ops: create / connect / group / delete', () => {
  test('create stickies + group + connect to an existing node + delete, via stdin', () => {
    const existingId = board('ui-flow').find((e) => e.type === 'shape')?.id as string;
    const res = annotate(['ui/Flow.tsx'], {
      ops: [
        { op: 'create', type: 'sticky', ref: '@n1', text: 'pain point', x: 100, y: 600 },
        { op: 'create', type: 'sticky', ref: '@n2', text: 'idea', x: 340, y: 600 },
        { op: 'group', ids: ['@n1', '@n2'] },
        { op: 'connect', from: '@n1', to: existingId },
      ],
    });
    expect(res.code).toBe(0);
    const { refs, created, updated } = JSON.parse(res.out);
    expect(created).toBe(3);
    expect(updated).toBe(2);
    expectCanonical('ui-flow');
    const els = byId('ui-flow');
    const n1 = els[refs['@n1']];
    const n2 = els[refs['@n2']];
    expect(n1?.groups).toHaveLength(1);
    expect(n1?.groups).toEqual(n2?.groups);
    expect(n1?.author).toEqual({ kind: 'ai' });
    const bound = board('ui-flow').filter(
      (e) => e.type === 'arrow' && (e.end as { el?: string }).el === existingId
    );
    expect(bound).toHaveLength(1);
    expect(bound[0]?.start).toEqual({ el: refs['@n1'] });

    const del = annotate(['ui/Flow.tsx'], { ops: [{ op: 'delete', id: refs['@n2'] }] });
    expect(del.code).toBe(0);
    expect(JSON.parse(del.out).deleted).toBe(1);
    expect(byId('ui-flow')[refs['@n2']]).toBeUndefined();
    expectCanonical('ui-flow');
  });

  test('deleting a connected host freezes the arrow end where it was (never a dangling bind)', () => {
    seed('ui-freeze', [
      { id: 'a', type: 'sticky', index: 'a0', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', type: 'sticky', index: 'a1', x: 300, y: 0, w: 100, h: 100 },
      { id: 'ar', type: 'arrow', index: 'a2', start: { el: 'a' }, end: { el: 'b' } },
    ]);
    const res = annotate(['ui/Freeze.tsx'], { ops: [{ op: 'delete', id: 'b' }] });
    expect(res.code).toBe(0);
    expect(byId('ui-freeze').ar?.end).toEqual({ x: 300, y: 50 });
  });

  test('an unknown connect target fails loud and writes nothing', () => {
    const before = boardText('ui-flow');
    const res = annotate(['ui/Flow.tsx'], { ops: [{ op: 'connect', from: '@ghost', to: 'nope' }] });
    expect(res.code).toBe(2);
    expect(res.err).toContain('unknown ref "@ghost"');
    expect(boardText('ui-flow')).toBe(before);
  });

  test('a connect to an element that takes no arrow ends fails loud', () => {
    seed('ui-nobind', [
      { id: 'a', type: 'sticky', index: 'a0', x: 0, y: 0, w: 100, h: 100 },
      { id: 'p', type: 'pen', index: 'a1', points: [0, 300, 100, 320] },
    ]);
    const res = annotate(['ui/NoBind.tsx'], { ops: [{ op: 'connect', from: 'a', to: 'p' }] });
    expect(res.code).toBe(2);
    expect(res.err).toContain("can't take an arrow end");
  });

  test('an unknown type / field / value fails loud, naming what is allowed', () => {
    const t = annotate(['ui/Bad.tsx'], { ops: [{ op: 'create', type: 'blob', x: 0, y: 0 }] });
    expect(t.code).toBe(2);
    expect(t.err).toContain('types: sticky');
    const f = annotate(['ui/Bad.tsx'], {
      ops: [{ op: 'create', type: 'sticky', text: 'x', glitter: true, x: 0, y: 0 }],
    });
    expect(f.code).toBe(2);
    expect(f.err).toContain('sticky has no field "glitter"');
    const v = annotate(['ui/Bad.tsx'], {
      ops: [{ op: 'create', type: 'sticky', text: 'x', fill: 'red', x: 0, y: 0 }],
    });
    expect(v.code).toBe(2);
    expect(v.err).toContain('invalid value for sticky.fill');
    expect(existsSync(pathOf('ui-bad'))).toBe(false);
  });

  test('--dry-run prints the element ops and writes nothing', () => {
    const before = boardText('ui-flow');
    const res = annotate(['ui/Flow.tsx', '--dry-run'], {
      ops: [{ op: 'create', type: 'text', text: 'ghost', x: 0, y: 0 }],
    });
    expect(res.code).toBe(0);
    const out = JSON.parse(res.out);
    expect(out.dryRun).toBe(true);
    expect(out.ops).toHaveLength(1);
    expect(out.ops[0].op).toBe('put');
    expect(out.ops[0].el).toMatchObject({ type: 'text', text: 'ghost', author: { kind: 'ai' } });
    expect(boardText('ui-flow')).toBe(before);
  });

  test('a created element joins the section its centre lands in (parent-relative coords)', () => {
    seed('ui-drop', [
      { id: 'sec', type: 'section', index: 'a0', x: 1000, y: 1000, w: 400, h: 400 },
    ]);
    const res = annotate(['ui/Drop.tsx'], {
      ops: [
        { op: 'create', type: 'sticky', ref: '@in', text: 'inside', x: 1050, y: 1050 },
        { op: 'create', type: 'sticky', ref: '@out', text: 'outside', x: 0, y: 0 },
        {
          op: 'create',
          type: 'sticky',
          ref: '@top',
          text: 'forced',
          x: 1100,
          y: 1100,
          parent: null,
        },
      ],
    });
    expect(res.code).toBe(0);
    const { refs } = JSON.parse(res.out);
    const els = byId('ui-drop');
    expect(els[refs['@in']]).toMatchObject({ parent: 'sec', x: 50, y: 50 });
    expect(els[refs['@out']]?.parent).toBeUndefined();
    expect(els[refs['@top']]?.parent).toBeUndefined();
    expect(worldBox('ui-drop', refs['@in'])).toMatchObject({ x: 1050, y: 1050 });
  });
});

describe('annotate update / move / reparent / reorder', () => {
  const seedAll = (slug: string) =>
    seed(slug, [
      { id: 'sec', type: 'section', index: 'a0', x: 1000, y: 0, w: 600, h: 600, label: 'Now' },
      {
        id: 'st',
        type: 'sticky',
        index: 'a1',
        x: 0,
        y: 0,
        w: 200,
        h: 200,
        text: 'old',
        fontSize: 20,
        bold: true,
        rot: 5,
        groups: ['g1'],
      },
      {
        id: 'sh',
        type: 'shape',
        index: 'a2',
        x: 0,
        y: 400,
        w: 100,
        h: 50,
        label: { text: 'L', fontSize: 18 },
      },
      { id: 'kid', type: 'sticky', parent: 'sec', index: 'a0', x: 10, y: 10, w: 100, h: 100 },
      { id: 'kid2', type: 'sticky', parent: 'sec', index: 'a1', x: 300, y: 10, w: 100, h: 100 },
      { id: 'img', type: 'image', index: 'a3', x: 0, y: 700, w: 100, h: 100, href: 'assets/a.png' },
    ]);

  test("update patches only the named fields; text goes to the type's text slot", () => {
    seedAll('ui-upd');
    const res = annotate(['ui/Upd.tsx'], {
      ops: [
        { op: 'update', id: 'st', text: 'new', color: '#bfe3c0' },
        { op: 'update', id: 'sh', text: 'Label!' },
        { op: 'update', id: 'sec', text: 'Later' },
      ],
    });
    expect(res.code).toBe(0);
    expectCanonical('ui-upd');
    const els = byId('ui-upd');
    // Every other field survives — id, fontSize, bold, rotation, groups.
    expect(els.st).toMatchObject({
      text: 'new',
      fill: '#bfe3c0',
      fontSize: 20,
      bold: true,
      rot: 5,
      groups: ['g1'],
    });
    expect(els.sh?.label).toEqual({ text: 'Label!', fontSize: 18 });
    expect(els.sec?.label).toBe('Later');
  });

  test('update: null resets a field to its default; world x/y become parent-relative', () => {
    seedAll('ui-upd2');
    const res = annotate(['ui/Upd2.tsx'], {
      ops: [
        { op: 'update', id: 'st', bold: null },
        { op: 'update', id: 'kid', x: 1200, y: 50 },
      ],
    });
    expect(res.code).toBe(0);
    const els = byId('ui-upd2');
    expect(els.st?.bold).toBeUndefined();
    expect(els.kid).toMatchObject({ parent: 'sec', x: 200, y: 50 });
  });

  test('update refuses ids / structure fields / fields the type lacks', () => {
    seedAll('ui-upd3');
    const before = boardText('ui-upd3');
    const p = annotate(['ui/Upd3.tsx'], { ops: [{ op: 'update', id: 'st', parent: 'sec' }] });
    expect(p.code).toBe(2);
    expect(p.err).toContain('use reparent');
    const c = annotate(['ui/Upd3.tsx'], {
      ops: [{ op: 'set-color', id: 'img', color: '#000000' }],
    });
    expect(c.code).toBe(2);
    expect(c.err).toContain('image has no field "color"');
    const g = annotate(['ui/Upd3.tsx'], { ops: [{ op: 'update', id: 'ghost', text: 'x' }] });
    expect(g.code).toBe(2);
    expect(g.err).toContain('unknown id "ghost"');
    expect(boardText('ui-upd3')).toBe(before);
  });

  test("set-text / set-color are update aliases (a sticky's colour is its paper)", () => {
    seedAll('ui-alias');
    const res = annotate(['ui/Alias.tsx'], {
      ops: [
        { op: 'set-text', id: 'st', text: 'aliased' },
        { op: 'set-color', id: 'st', color: '#a9dbdb' },
        { op: 'set-color', id: 'sh', color: '#e93d82' },
      ],
    });
    expect(res.code).toBe(0);
    const els = byId('ui-alias');
    expect(els.st).toMatchObject({ text: 'aliased', fill: '#a9dbdb' });
    expect(els.sh?.color).toBe('#e93d82');
  });

  test('ops chain inside one batch — on @refs and on existing ids', () => {
    seedAll('ui-chain');
    const res = annotate(['ui/Chain.tsx'], {
      ops: [
        { op: 'create', type: 'sticky', ref: '@s', text: 'a', x: 0, y: 1000 },
        { op: 'move', id: '@s', dx: 10, dy: 0 },
        { op: 'set-text', id: '@s', text: 'b' },
        { op: 'move', id: 'st', dx: 5, dy: 5 },
        { op: 'set-text', id: 'st', text: 'c' },
      ],
    });
    expect(res.code).toBe(0);
    const { refs } = JSON.parse(res.out);
    const els = byId('ui-chain');
    expect(els[refs['@s']]).toMatchObject({ x: 10, y: 1000, text: 'b' });
    expect(els.st).toMatchObject({ x: 5, y: 5, text: 'c', fontSize: 20 });
  });

  test('move to world x/y joins the section it lands in; out again goes top level', () => {
    seedAll('ui-move');
    const into = annotate(['ui/Move.tsx'], { ops: [{ op: 'move', id: 'st', x: 1100, y: 300 }] });
    expect(into.code).toBe(0);
    expect(byId('ui-move').st).toMatchObject({ parent: 'sec', x: 100, y: 300 });
    expect(worldBox('ui-move', 'st')).toMatchObject({ x: 1100, y: 300 });
    const out = annotate(['ui/Move.tsx'], { ops: [{ op: 'move', id: 'st', x: 0, y: 0 }] });
    expect(out.code).toBe(0);
    expect(byId('ui-move').st?.parent).toBeUndefined();
    expect(worldBox('ui-move', 'st')).toMatchObject({ x: 0, y: 0 });
  });

  test('moving a section carries its children (their records do not change)', () => {
    seedAll('ui-movesec');
    const kidBefore = byId('ui-movesec').kid;
    const res = annotate(['ui/MoveSec.tsx'], {
      ops: [{ op: 'move', id: 'sec', dx: 100, dy: 100 }],
    });
    expect(res.code).toBe(0);
    expect(byId('ui-movesec').kid).toEqual(kidBefore as AnnotationElement);
    expect(worldBox('ui-movesec', 'kid')).toMatchObject({ x: 1110, y: 110 });
  });

  test('move: a free arrow end moves; an arrow bound at both ends fails loud', () => {
    seed('ui-movearrow', [
      { id: 'a', type: 'sticky', index: 'a0', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', type: 'sticky', index: 'a1', x: 300, y: 0, w: 100, h: 100 },
      { id: 'bound', type: 'arrow', index: 'a2', start: { el: 'a' }, end: { el: 'b' } },
      { id: 'half', type: 'arrow', index: 'a3', start: { el: 'a' }, end: { x: 50, y: 400 } },
    ]);
    const bad = annotate(['ui/MoveArrow.tsx'], {
      ops: [{ op: 'move', id: 'bound', dx: 5, dy: 5 }],
    });
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('bound at both ends');
    const ok = annotate(['ui/MoveArrow.tsx'], {
      ops: [{ op: 'move', id: 'half', dx: 10, dy: 20 }],
    });
    expect(ok.code).toBe(0);
    expect(byId('ui-movearrow').half).toMatchObject({ start: { el: 'a' }, end: { x: 60, y: 420 } });
  });

  test('reparent keeps the world position; it refuses a non-section and its own subtree', () => {
    seedAll('ui-rep');
    const res = annotate(['ui/Rep.tsx'], {
      ops: [
        { op: 'reparent', id: 'st', parent: 'sec' },
        { op: 'reparent', id: 'kid', parent: null },
      ],
    });
    expect(res.code).toBe(0);
    const els = byId('ui-rep');
    expect(els.st).toMatchObject({ parent: 'sec', x: -1000, y: 0 });
    expect(worldBox('ui-rep', 'st')).toMatchObject({ x: 0, y: 0 });
    expect(els.kid?.parent).toBeUndefined();
    expect(worldBox('ui-rep', 'kid')).toMatchObject({ x: 1010, y: 10 });
    const notSec = annotate(['ui/Rep.tsx'], { ops: [{ op: 'reparent', id: 'kid', parent: 'sh' }] });
    expect(notSec.code).toBe(2);
    expect(notSec.err).toContain('is not a section');
    const self = annotate(['ui/Rep.tsx'], { ops: [{ op: 'reparent', id: 'sec', parent: 'sec' }] });
    expect(self.code).toBe(2);
    expect(self.err).toContain("can't go inside itself");
  });

  test('reorder changes ONE key: front / back / before / after', () => {
    seedAll('ui-order');
    const top = () => new Scene(board('ui-order')).childrenOf(null).map((e) => e.id);
    expect(top()).toEqual(['sec', 'st', 'sh', 'img']);
    const r1 = annotate(['ui/Order.tsx'], { ops: [{ op: 'reorder', id: 'sec', to: 'front' }] });
    expect(r1.code).toBe(0);
    expect(top()).toEqual(['st', 'sh', 'img', 'sec']);
    annotate(['ui/Order.tsx'], { ops: [{ op: 'reorder', id: 'img', to: 'back' }] });
    expect(top()).toEqual(['img', 'st', 'sh', 'sec']);
    annotate(['ui/Order.tsx'], { ops: [{ op: 'reorder', id: 'sec', before: 'st' }] });
    expect(top()).toEqual(['img', 'sec', 'st', 'sh']);
    const before = board('ui-order');
    annotate(['ui/Order.tsx'], { ops: [{ op: 'reorder', id: 'img', after: 'sh' }] });
    expect(top()).toEqual(['sec', 'st', 'sh', 'img']);
    // Only the moved element's record changed.
    const after = byId('ui-order');
    for (const e of before) if (e.id !== 'img') expect(after[e.id]).toEqual(e);
    const notSib = annotate(['ui/Order.tsx'], {
      ops: [{ op: 'reorder', id: 'st', before: 'kid' }],
    });
    expect(notSib.code).toBe(2);
    expect(notSib.err).toContain('not a sibling');
  });

  test('a single-element update stays tiny whatever the board size (token gate)', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      id: `n${i}`,
      type: 'sticky',
      index: `a${i.toString(36)}`,
      x: (i % 20) * 220,
      y: Math.floor(i / 20) * 220,
      w: 200,
      h: 200,
      text: `note ${i}`,
    }));
    seed('ui-big', many);
    const input = { ops: [{ op: 'update', id: 'n42', text: 'shipped' }] };
    // What the agent writes: well under 40 tokens (~4 bytes/token).
    expect(JSON.stringify(input).length).toBeLessThanOrEqual(160);
    const dry = annotate(['ui/Big.tsx', '--dry-run'], input);
    expect(dry.code).toBe(0);
    const ops = JSON.parse(dry.out).ops;
    expect(ops).toEqual([
      { op: 'patch', id: 'n42', set: { text: 'shipped' }, expect: { text: 'note 42' } },
    ]);
  });
});

describe('annotate — the board file is guarded', () => {
  test('an existing board that is not a board is refused, and left untouched', () => {
    writeFileSync(pathOf('ui-corrupt'), '{"format":"something-else"}');
    const res = annotate(['ui/Corrupt.tsx'], {
      ops: [{ op: 'create', type: 'sticky', text: 'x', x: 0, y: 0 }],
    });
    expect(res.code).toBe(2);
    expect(res.err).toContain('not a valid board — refusing to write over it');
    expect(boardText('ui-corrupt')).toBe('{"format":"something-else"}');
  });

  test('a symlinked board is never read through nor written through (W1)', () => {
    const outside = mkdtempSync(join(tmpdir(), 'annotate-outside-'));
    const victim = join(outside, 'victim.json');
    writeFileSync(victim, 'keep me');
    symlinkSync(victim, pathOf('ui-link'));
    const res = annotate(['ui/Link.tsx'], {
      ops: [{ op: 'create', type: 'sticky', text: 'x', x: 0, y: 0 }],
    });
    expect(res.code).not.toBe(0);
    expect(readFileSync(victim, 'utf8')).toBe('keep me');
    rmSync(outside, { recursive: true, force: true });
  });

  test('a symlinked _state/ scratch dir is refused — no temp file lands outside (W1)', () => {
    const outside = mkdtempSync(join(tmpdir(), 'annotate-state-'));
    const state = join(root, '.design', '_state');
    const had = existsSync(state);
    if (had) rmSync(state, { recursive: true, force: true });
    symlinkSync(outside, state);
    try {
      const res = annotate(['ui/Scratch.tsx'], {
        ops: [{ op: 'create', type: 'sticky', text: 'x', x: 0, y: 0 }],
      });
      expect(res.code).not.toBe(0);
      expect(existsSync(pathOf('ui-scratch'))).toBe(false);
    } finally {
      rmSync(state, { force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('an oversized board is refused before it is read', () => {
    writeFileSync(pathOf('ui-huge'), 'x'.repeat(4 * 1024 * 1024 + 10));
    const res = annotate(['ui/Huge.tsx'], {
      ops: [{ op: 'create', type: 'sticky', text: 'x', x: 0, y: 0 }],
    });
    expect(res.code).toBe(2);
    expect(res.err).toContain('refusing to read');
  });

  test('a legacy .annotations.svg is migrated on read and written back as .json', () => {
    writeFileSync(
      join(root, '.design', 'ui-legacy.annotations.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" data-mdcc-annotations="1"><g data-id="s1" data-tool="sticky" fill="#fce8a6"><rect x="0" y="0" width="200" height="200" rx="8" ry="8"/><text data-sticky-body="1" x="12" y="12" font-size="14" fill="#1a1a1a" dominant-baseline="hanging">legacy</text></g></svg>'
    );
    const res = annotate(['ui/Legacy.tsx'], {
      ops: [{ op: 'set-text', id: 's1', text: 'migrated' }],
    });
    expect(res.code).toBe(0);
    expect(byId('ui-legacy').s1?.text).toBe('migrated');
  });
});

describe('annotate placement: --in / --pin / --near', () => {
  const rects = (name: string, body: unknown) => {
    const p = join(root, name);
    writeFileSync(p, JSON.stringify(body));
    return p;
  };

  test('--in places inside the artboard (top-left + inset)', () => {
    const p = rects('rects-in.json', {
      artboards: [{ id: 'hero', x: 1000, y: 2000, w: 400, h: 300 }],
      elements: [],
    });
    const res = annotate(['ui/In.tsx', '--rects', p, '--in', 'hero'], {
      ops: [{ op: 'create', type: 'sticky', text: 'inside hero' }],
    });
    expect(res.code).toBe(0);
    const [s] = board('ui-in');
    expect(s).toMatchObject({ x: 1040, y: 2040 });
  });

  test('--in with an unknown artboard fails loud, writes nothing', () => {
    const p = rects('rects-in2.json', { artboards: [{ id: 'hero', x: 0, y: 0, w: 1, h: 1 }] });
    const res = annotate(['ui/InMissing.tsx', '--rects', p, '--in', 'ghost'], {
      ops: [{ op: 'create', type: 'sticky', text: 'x' }],
    });
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/unknown artboard "ghost"/);
    expect(existsSync(pathOf('ui-inmissing'))).toBe(false);
  });

  const cta = {
    cdId: 'cta1',
    selector: '[data-cd-id="cta1"]',
    x: 500,
    y: 500,
    w: 120,
    h: 40,
    tag: 'button',
    text: 'Continue',
  };

  test('--pin places beside the element with a pointer arrow bound to the note', () => {
    const p = rects('rects-pin.json', { artboards: [], elements: [cta] });
    const res = annotate(['ui/Pin.tsx', '--rects', p, '--pin', 'cta1'], {
      ops: [{ op: 'create', type: 'sticky', text: 'make this bigger' }],
    });
    expect(res.code).toBe(0);
    expectCanonical('ui-pin');
    const sticky = board('ui-pin').find((e) => e.type === 'sticky');
    expect(sticky).toMatchObject({ x: 660, y: 500 }); // cta.x + cta.w + 40
    const arrows = board('ui-pin').filter((e) => e.type === 'arrow');
    expect(arrows).toHaveLength(1);
    // Start follows the note; the end is a free point on the DOM element's edge.
    expect(arrows[0]?.start).toEqual({ el: sticky?.id });
    // The element side facing the note centre (760, 600): its bottom middle.
    expect(arrows[0]?.end).toEqual({ x: 560, y: 540 });
    expect(arrows[0]?.author).toEqual({ kind: 'ai' });
  });

  test('--pin to an unknown element fails loud', () => {
    const p = rects('rects-pin2.json', { artboards: [], elements: [] });
    const res = annotate(['ui/PinGhost.tsx', '--rects', p, '--pin', 'ghost'], {
      ops: [{ op: 'create', type: 'sticky', text: 'x' }],
    });
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/element "ghost" not found/);
  });

  test('--no-pointer keeps the placement and skips the arrow; a per-op pin overrides', () => {
    const p = rects('rects-pin3.json', {
      artboards: [],
      elements: [cta, { ...cta, cdId: 'target', x: 900, y: 900, w: 50, h: 50 }],
    });
    const res = annotate(['ui/NoPointer.tsx', '--rects', p, '--pin', 'cta1', '--no-pointer'], {
      ops: [
        { op: 'create', type: 'sticky', ref: '@a', text: 'quiet' },
        { op: 'create', type: 'sticky', ref: '@b', text: 'pinned', pin: 'target' },
      ],
    });
    expect(res.code).toBe(0);
    const { refs } = JSON.parse(res.out);
    const els = byId('ui-nopointer');
    expect(board('ui-nopointer').filter((e) => e.type === 'arrow')).toHaveLength(0);
    expect(els[refs['@a']]).toMatchObject({ x: 660, y: 500 });
    expect(els[refs['@b']]).toMatchObject({ x: 990, y: 900 });
  });

  test('--near places a whole board beside an artboard', () => {
    const p = rects('rects-near.json', {
      artboards: [{ id: 'hero', x: 2000, y: 3000, w: 400, h: 300 }],
    });
    writeFileSync(
      join(root, 'near-board.json'),
      JSON.stringify({ groups: [{ title: 'Notes', cards: ['x'] }] })
    );
    const res = annotate([
      'ui/NearBoard.tsx',
      '--rects',
      p,
      '--near',
      'hero',
      '--board',
      join(root, 'near-board.json'),
    ]);
    expect(res.code).toBe(0);
    const sec = board('ui-nearboard').find((e) => e.type === 'section');
    expect(sec).toMatchObject({ x: 2480, y: 3000 }); // hero.x + hero.w + 80
  });
});

describe('annotate --board templates', () => {
  const spec = (name: string, body: unknown) => {
    const p = join(root, name);
    writeFileSync(p, JSON.stringify(body));
    return p;
  };
  const sections = (slug: string) =>
    board(slug)
      .filter((e) => e.type === 'section')
      .sort((a, b) => (a.x as number) - (b.x as number));
  const noOverlap = (rs: AnnotationElement[]) => {
    for (let i = 1; i < rs.length; i += 1) {
      const prev = rs[i - 1] as AnnotationElement;
      expect(rs[i]?.x as number).toBeGreaterThanOrEqual((prev.x as number) + (prev.w as number));
    }
  };

  test('retro (columns, empty) — evenly-spaced blank sections', () => {
    const p = spec('retro-empty.json', {
      groups: [
        { title: 'What went well', cards: [] },
        { title: 'What to improve', cards: [] },
        { title: 'Action items', cards: [] },
      ],
    });
    const res = annotate(['ui/RetroEmpty.tsx', '--board', p]);
    expect(res.code).toBe(0);
    expectCanonical('ui-retroempty');
    const secs = sections('ui-retroempty');
    expect(secs.map((s) => s.label)).toEqual(['What went well', 'What to improve', 'Action items']);
    expect(new Set(secs.map((s) => s.h)).size).toBe(1);
    noOverlap(secs);
  });

  test("retro (columns, seeded) — cards are the section's CHILDREN, stacked without overlap", () => {
    const p = spec('retro-seeded.json', {
      groups: [
        {
          title: 'Went well',
          color: '#bbf7d0',
          cards: ['shipped on time', { text: 'good pairing', color: '#a9dbdb' }],
        },
        { title: 'To improve', cards: ['too many meetings'] },
      ],
    });
    const res = annotate(['ui/RetroSeeded.tsx', '--board', p]);
    expect(res.code).toBe(0);
    const [well, improve] = sections('ui-retroseeded');
    expect(well?.color).toBe('#bbf7d0');
    noOverlap([well, improve] as AnnotationElement[]);
    const kids = board('ui-retroseeded')
      .filter((e) => e.parent === well?.id)
      .sort((a, b) => (a.y as number) - (b.y as number));
    expect(kids.map((k) => k.text)).toEqual(['shipped on time', 'good pairing']);
    expect(kids[1]?.fill).toBe('#a9dbdb');
    expect(kids[1]?.y as number).toBeGreaterThanOrEqual(
      (kids[0]?.y as number) + (kids[0]?.h as number)
    );
    expect(board('ui-retroseeded').filter((e) => e.parent === improve?.id)).toHaveLength(1);
  });

  test('social calendar (7 columns) — 7 sections + 7 stickies, no overlap', () => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const p = spec('calendar.json', {
      groups: days.map((d) => ({ title: d, cards: [`${d} post`] })),
    });
    const res = annotate(['ui/Calendar.tsx', '--board', p]);
    expect(res.code).toBe(0);
    const secs = sections('ui-calendar');
    expect(secs.map((s) => s.label)).toEqual(days);
    noOverlap(secs);
    expect(board('ui-calendar').filter((e) => e.type === 'sticky')).toHaveLength(7);
  });

  test('user flow (layout "flow") shares --flow\'s layout and reads back as a graph', () => {
    const p = spec('userflow.json', {
      layout: 'flow',
      nodes: [
        { id: 'start', label: 'Landing' },
        { id: 'signup', label: 'Sign up' },
        { id: 'done', label: 'Onboarded', shape: 'ellipse' },
      ],
      edges: [
        { from: 'start', to: 'signup' },
        { from: 'signup', to: 'done', label: 'verified' },
      ],
    });
    const res = annotate(['ui/UserFlow.tsx', '--board', p]);
    expect(res.code).toBe(0);
    const parsed = readGraph('ui/UserFlow.tsx');
    expect(parsed.graph.edges).toHaveLength(2);
    expect(parsed.graph.nodes.map((n) => n.text).sort()).toEqual([
      'Landing',
      'Onboarded',
      'Sign up',
    ]);
  });

  test('brainstorm (radial) — a centre topic ellipse + ideas around it', () => {
    const p = spec('brainstorm.json', {
      title: 'How do we grow retention?',
      layout: 'radial',
      groups: [{ cards: ['onboarding email', 'in-app tips', 'referral bonus'] }],
    });
    const res = annotate(['ui/Brainstorm.tsx', '--board', p]);
    expect(res.code).toBe(0);
    const center = board('ui-brainstorm').find((e) => e.type === 'shape');
    expect(center?.kind).toBe('ellipse');
    expect((center?.label as { text: string } | undefined)?.text).toBe('How do we grow retention?');
    expect(board('ui-brainstorm').filter((e) => e.type === 'sticky')).toHaveLength(3);
  });

  test('connections[] draws bound arrows between minted refs', () => {
    const p = spec('connected.json', {
      groups: [
        { title: 'Backlog', cards: ['idea A'] },
        { title: 'Done', cards: ['shipped B'] },
      ],
      connections: [{ from: '@sec0', to: '@sec1', label: 'promoted' }],
    });
    const res = annotate(['ui/Connected.tsx', '--board', p]);
    expect(res.code).toBe(0);
    const arrows = board('ui-connected').filter((e) => e.type === 'arrow');
    expect(arrows).toHaveLength(1);
    expect(arrows[0]?.start).toHaveProperty('el');
    expect(arrows[0]?.end).toHaveProperty('el');
    expect(board('ui-connected').some((e) => e.type === 'text' && e.text === 'promoted')).toBe(
      true
    );
  });

  test('--board and --ops together are rejected', () => {
    const p = spec('excl.json', { groups: [{ cards: [] }] });
    const res = annotate(['ui/Excl.tsx', '--board', p, '--ops', p]);
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/mutually exclusive/);
  });

  // Security regressions (feature-whiteboard-ai-toolkit review): every array a
  // spec can use to manufacture ops is capped BEFORE expansion.
  test.each([
    [
      { groups: Array.from({ length: 25 }, (_, i) => ({ title: `g${i}`, cards: [] })) },
      /groups\[\] has 25, max 20/,
    ],
    [
      { groups: [{ title: 'g', cards: Array.from({ length: 60 }, (_, i) => `c${i}`) }] },
      /has 60 cards, max 50/,
    ],
    [
      {
        groups: Array.from({ length: 20 }, (_, i) => ({
          title: `g${i}`,
          cards: Array.from({ length: 16 }, () => 'c'),
        })),
      },
      /320 total cards across groups, max 300/,
    ],
    [
      { layout: 'flow', nodes: Array.from({ length: 201 }, (_, i) => ({ id: `n${i}` })) },
      /nodes\[\] has 201, max 200/,
    ],
    [
      {
        groups: [{ title: 'g', cards: ['a'] }],
        connections: Array.from({ length: 401 }, () => ({ from: '@sec0', to: '@sec0card0' })),
      },
      /connections\[\] has 401, max 400/,
    ],
  ])('--board caps: %#', (body, msg) => {
    const p = spec('capped.json', body);
    const res = annotate(['ui/Capped.tsx', '--board', p]);
    expect(res.code).toBe(2);
    expect(res.err).toMatch(msg);
  });

  test('--flow caps edges[] too', () => {
    const p = spec('flow-edges.json', {
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: Array.from({ length: 401 }, () => ({ from: 'a', to: 'b' })),
    });
    const res = annotate(['ui/FlowEdges.tsx', '--flow', p]);
    expect(res.code).toBe(2);
    expect(res.err).toMatch(/edges\[\] has 401, max 400/);
  });
});

describe('annotate — the live-server path', () => {
  test('ops go to POST /_api/annotations/ops on a loopback server; the file is not written', async () => {
    const got: Array<{
      file: string;
      actionId: string;
      ops: Array<{ op: string; el?: Record<string, unknown> }>;
    }> = [];
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        if (new URL(req.url).pathname !== '/_api/annotations/ops')
          return new Response('nf', { status: 404 });
        got.push(await req.json());
        return Response.json({ ok: true, changed: true, rejected: [] });
      },
    });
    const serverJson = join(root, '.design', '_server.json');
    writeFileSync(serverJson, JSON.stringify({ url: `http://127.0.0.1:${server.port}` }));
    try {
      const res = await annotateAsync(['ui/Live.tsx'], {
        ops: [{ op: 'create', type: 'sticky', text: 'live', x: 0, y: 0 }],
      });
      expect(res.code).toBe(0);
      expect(JSON.parse(res.out).via).toBe('server');
      expect(got).toHaveLength(1);
      expect(got[0]?.file).toBe('.design/ui/Live.tsx');
      expect(got[0]?.actionId).toMatch(/^ai-annotate-[a-z0-9]+$/);
      expect(got[0]?.ops[0]?.op).toBe('put');
      expect(got[0]?.ops[0]?.el).toMatchObject({
        type: 'sticky',
        text: 'live',
        author: { kind: 'ai' },
      });
      expect(existsSync(pathOf('ui-live'))).toBe(false);
    } finally {
      rmSync(serverJson, { force: true });
      server.stop(true);
    }
  });

  test('a path written with the design-root prefix reaches the SAME board on the server', async () => {
    const got: Array<{ file: string }> = [];
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        got.push(await req.json());
        return Response.json({ ok: true, changed: true, rejected: [] });
      },
    });
    const serverJson = join(root, '.design', '_server.json');
    writeFileSync(serverJson, JSON.stringify({ url: `http://127.0.0.1:${server.port}` }));
    try {
      const res = await annotateAsync(['.design/ui/Prefixed.tsx'], {
        ops: [{ op: 'create', type: 'sticky', text: 'x', x: 0, y: 0 }],
      });
      expect(res.code).toBe(0);
      expect(got[0]?.file).toBe('.design/ui/Prefixed.tsx');
    } finally {
      rmSync(serverJson, { force: true });
      server.stop(true);
    }
  });

  test('inside a cloud workspace a read-only refusal from its own studio writes the file', async () => {
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => Response.json({ error: 'read-only' }, { status: 403 }),
    });
    const serverJson = join(root, '.design', '_server.json');
    writeFileSync(serverJson, JSON.stringify({ url: `http://127.0.0.1:${server.port}` }));
    try {
      const res = await annotateAsync(
        ['ui/Cell.tsx'],
        { ops: [{ op: 'create', type: 'sticky', text: 'x', x: 0, y: 0 }] },
        { MAUDE_WORKSPACE_MODE: '1' }
      );
      expect(res.code).toBe(0);
      expect(JSON.parse(res.out).via).toBe('file');
      expect(existsSync(pathOf('ui-cell'))).toBe(true);
    } finally {
      rmSync(serverJson, { force: true });
      server.stop(true);
    }
  });

  test('a server that refuses the batch (409) fails the verb — no silent file write', async () => {
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () =>
        Response.json({ ok: false, error: 'board file is not a valid board' }, { status: 409 }),
    });
    const serverJson = join(root, '.design', '_server.json');
    writeFileSync(serverJson, JSON.stringify({ url: `http://127.0.0.1:${server.port}` }));
    try {
      const res = await annotateAsync(['ui/Refused.tsx'], {
        ops: [{ op: 'create', type: 'sticky', text: 'x', x: 0, y: 0 }],
      });
      expect(res.code).toBe(1);
      expect(res.err).toContain('refused the batch');
      expect(existsSync(pathOf('ui-refused'))).toBe(false);
    } finally {
      rmSync(serverJson, { force: true });
      server.stop(true);
    }
  });

  test.each([
    400, 403, 500,
  ])('a live server answering %i fails the verb — no file write behind its back (A2)', async (status) => {
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => new Response('nope', { status }),
    });
    const serverJson = join(root, '.design', '_server.json');
    writeFileSync(serverJson, JSON.stringify({ url: `http://127.0.0.1:${server.port}` }));
    try {
      const res = await annotateAsync([`ui/Status${status}.tsx`], {
        ops: [{ op: 'create', type: 'sticky', text: 'x', x: 0, y: 0 }],
      });
      expect(res.code).toBe(1);
      expect(res.err).toContain('refused the batch');
      expect(existsSync(pathOf(`ui-status${status}`))).toBe(false);
    } finally {
      rmSync(serverJson, { force: true });
      server.stop(true);
    }
  });

  test('a server without the op route (404) — the verb writes the file', async () => {
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      fetch: () => new Response('not found', { status: 404 }),
    });
    const serverJson = join(root, '.design', '_server.json');
    writeFileSync(serverJson, JSON.stringify({ url: `http://127.0.0.1:${server.port}` }));
    try {
      const res = await annotateAsync(['ui/Old.tsx'], {
        ops: [{ op: 'create', type: 'sticky', text: 'x', x: 0, y: 0 }],
      });
      expect(res.code).toBe(0);
      expect(JSON.parse(res.out).via).toBe('file');
    } finally {
      rmSync(serverJson, { force: true });
      server.stop(true);
    }
  });

  test('a non-loopback _server.json url is never contacted — the verb writes the file (F2)', () => {
    const serverJson = join(root, '.design', '_server.json');
    writeFileSync(serverJson, JSON.stringify({ url: 'http://attacker.example.com:4399' }));
    try {
      const res = annotate(['ui/F2.tsx'], {
        ops: [{ op: 'create', type: 'text', text: 'secret', x: 0, y: 0 }],
      });
      expect(res.code).toBe(0);
      expect(JSON.parse(res.out).via).toBe('file');
      expect(board('ui-f2')[0]?.text).toBe('secret');
    } finally {
      rmSync(serverJson, { force: true });
    }
  });
});

describe('annotate --help comes from the registry', () => {
  test('every registry type is listed with its fields', () => {
    const proc = Bun.spawnSync(['bun', BIN, '--help']);
    const help = new TextDecoder().decode(proc.stdout);
    for (const t of [
      'sticky',
      'text',
      'shape',
      'arrow',
      'pen',
      'image',
      'link',
      'mediaref',
      'section',
    ]) {
      expect(help).toMatch(new RegExp(`^  ${t}\\s`, 'm'));
    }
    expect(help).toContain('update');
    expect(help).toContain('reparent');
    expect(help).toContain('reorder');
  });
});

// V2-2.8 B3 — an ABSOLUTE canvas path (what Claude's own file tools hand an
// agent) used to answer ok while writing a NEW board named after the whole
// path, and read-annotations read an empty one: fileSlug never stripped the
// repo root. The path now resolves against the repo; outside <designRoot> is
// refused with exit 2 and nothing is written.
describe('B3 — an absolute canvas path resolves to the same board', () => {
  const read = (rel: string) => {
    const proc = Bun.spawnSync(['bun', READER, rel, '--root', root]);
    return {
      code: proc.exitCode ?? 1,
      out: new TextDecoder().decode(proc.stdout),
      err: new TextDecoder().decode(proc.stderr),
    };
  };
  const boardsOnDisk = () =>
    readdirSync(join(root, '.design')).filter((f) => f.endsWith('.annotations.json'));
  const texts = (out: string) =>
    (JSON.parse(out).elements as Array<{ text?: string }>).map((e) => e.text);

  test('annotate with an absolute path writes ui-abs, and the relative form reads it back', () => {
    const before = boardsOnDisk();
    const abs = join(root, '.design', 'ui', 'Abs.tsx');
    const res = annotate([abs], {
      ops: [{ op: 'create', type: 'sticky', text: 'abs', x: 0, y: 0 }],
    });
    expect(res.code).toBe(0);
    expect(JSON.parse(res.out).file).toBe(pathOf('ui-abs'));
    expect(board('ui-abs').map((e) => e.text)).toEqual(['abs']);
    // Exactly one new board, and it is ui-abs — not a slug of the whole path.
    expect(boardsOnDisk().filter((f) => !before.includes(f))).toEqual(['ui-abs.annotations.json']);
    expect(texts(read('ui/Abs.tsx').out)).toEqual(['abs']);
  });

  test('read-annotations with an absolute path reads the same board', () => {
    const res = read(join(root, '.design', 'ui', 'Abs.tsx'));
    expect(res.code).toBe(0);
    expect(texts(res.out)).toEqual(['abs']);
  });

  test('the realpath spelling of the repo (macOS /private/var…) is the same repo', () => {
    const res = read(join(realpathSync(root), '.design', 'ui', 'Abs.tsx'));
    expect(res.code).toBe(0);
    expect(texts(res.out)).toEqual(['abs']);
  });

  test.each([
    ['an absolute path outside the repo', () => join(tmpdir(), 'elsewhere', 'X.tsx')],
    ['an absolute path in the repo but outside <designRoot>', () => join(root, 'src', 'X.tsx')],
    ['a relative path that climbs out of <designRoot>', () => 'ui/../../X.tsx'],
  ])('%s is refused with exit 2 and writes nothing', (_name, arg) => {
    const before = boardsOnDisk();
    const res = annotate([arg()], {
      ops: [{ op: 'create', type: 'sticky', text: 'no', x: 0, y: 0 }],
    });
    expect(res.code).toBe(2);
    expect(res.err).toContain('outside');
    expect(boardsOnDisk()).toEqual(before);
    const r = read(arg());
    expect(r.code).toBe(2);
    expect(r.err).toContain('outside');
  });

  test('with a live server, the absolute path reaches the server as the design-root path', async () => {
    const got: Array<{ file: string }> = [];
    const server = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(req) {
        got.push(await req.json());
        return Response.json({ ok: true, changed: true, rejected: [] });
      },
    });
    const serverJson = join(root, '.design', '_server.json');
    writeFileSync(serverJson, JSON.stringify({ url: `http://127.0.0.1:${server.port}` }));
    try {
      const res = await annotateAsync([join(root, '.design', 'ui', 'AbsLive.tsx')], {
        ops: [{ op: 'create', type: 'sticky', text: 'x', x: 0, y: 0 }],
      });
      expect(res.code).toBe(0);
      expect(got[0]?.file).toBe('.design/ui/AbsLive.tsx');
    } finally {
      rmSync(serverJson, { force: true });
      server.stop(true);
    }
  });
});
