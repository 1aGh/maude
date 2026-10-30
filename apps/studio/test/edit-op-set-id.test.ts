// S2.2b — `element.set-id`: rename one element id AND every durable reference to it on that canvas
// (V2-1.4 §5.5), as one undo step; refused when the new id is taken / invalid / held, when an AI
// run holds the element, and when the references can't move in one step (accepted mode).

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ballotId } from '../annotations/elements/ballot.model.ts';
import { stampId } from '../annotations/elements/stamp.model.ts';
import { applyOps, type Op } from '../annotations/ops.ts';
import { withFormat1Reader } from '../annotations/registry.ts';
import { parseBoard, serializeBoard, validateElements } from '../annotations/schema.ts';
import { elementsToStrokes } from '../annotations/v1-adapter.ts';
import { listElements } from '../canvas-edit.ts';
import { withSanitizedAnchors } from '../comments/anchors.ts';
import {
  type DispatchDeps,
  dispatchEditOp,
  ID_HELD_BY_REFERENCE_MESSAGE,
  RENAME_SPLIT_MESSAGE,
  statusOf,
} from '../edit-ops/dispatch.ts';
import { createReferenceLanes, type ReferenceIo } from '../edit-ops/references.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import { ID_TAKEN_MESSAGE } from '../edit-ops/set-id.ts';
import type { EditOpResult, IdRename } from '../edit-ops/types.ts';
import { createEditRoutes } from '../routes/edit.ts';

const FILE = 'ui/Home.tsx';
const OTHER = 'ui/Other.tsx';
const KEY = `.design/${FILE}`;
const OTHER_KEY = `.design/${OTHER}`;
const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Home() {
  return (
    <DesignCanvas>
      <DCArtboard id="desktop" label="Desktop" width={800} height={500}>
        <section data-cd-id="hero" className="hero">
          <a data-cd-id="cta" href="#call" className="btn">Book a call</a>
          <img data-cd-id="logo" data-cd-locked className="logo" src="/logo.svg" alt="Acme" />
        </section>
        <footer data-cd-id="footer">Footer</footer>
      </DCArtboard>
    </DesignCanvas>
  );
}
`;

const comment = (id: string, selector: string, file = KEY) => ({
  id,
  file,
  selector,
  dom_path: ['a.btn'],
  tag: 'a',
  classes: 'btn',
  bounds: { x: 1, y: 2, w: 3, h: 4 },
  html_excerpt: '<a data-cd-id="cta">',
  text: 'Make this bigger',
  status: 'open',
  created: '2026-10-18T10:00:00Z',
  resolved_at: null,
  author: 'Tereza',
  thread: [],
  mentions: [],
  artboard: 'desktop',
  // a key from a newer Maude: every reader keeps it (V2-1.12 §5.1)
  future: { kept: true },
});

const board = (els: Record<string, unknown>[]) => serializeBoard(validateElements(els).elements);
const BOARD = () =>
  board([
    { id: 'n1', type: 'sticky', index: 'a0', x: 0, y: 0, w: 200, h: 120, text: 'Too small?' },
    {
      id: 'ar',
      type: 'arrow',
      index: 'a1',
      start: { x: 200, y: 60 },
      end: { x: 400, y: 60 },
      startHost: { ref: 'ab:desktop', label: 'Desktop' },
      endHost: {
        ref: 'el:desktop/cta',
        label: 'Book a call',
        box: { x: 380, y: 40, w: 40, h: 40 },
      },
    },
    {
      id: stampId({ spot: 'el:desktop/cta', author: 'u_ana', kind: 'heart' }),
      type: 'stamp',
      index: 'a2',
      x: 380,
      y: 40,
      w: 32,
      h: 32,
      kind: 'heart',
      target: 'el:desktop/cta',
    },
    { id: 'vote1', type: 'vote', index: 'a3', targets: ['el:desktop/cta', 'ab:desktop'] },
    {
      id: ballotId('vote1', 'u_ana'),
      type: 'ballot',
      index: 'a4',
      vote: 'vote1',
      voter: 'u_ana',
      picks: { 'el:desktop/cta': 2 },
    },
  ]);

function harness(o: { accepted?: boolean; failBoard?: boolean } = {}) {
  const files = new Map<string, string>([
    [FILE, SRC],
    [OTHER, SRC],
  ]);
  const comments = new Map<string, unknown[]>([
    [
      KEY,
      [
        comment('c_pin', '[data-dc-screen="desktop"] [data-cd-id="cta"]'),
        comment('c_hero', '[data-cd-id="hero"]'),
      ],
    ],
    [OTHER_KEY, [comment('c_other', '[data-cd-id="cta"]', OTHER_KEY)]],
  ]);
  const boards = new Map<string, string>([
    [KEY, BOARD()],
    [OTHER_KEY, BOARD()],
  ]);
  const held = new Map<string, { mine: boolean }>();
  const state = { accepted: !!o.accepted, failBoard: !!o.failBoard };
  const io: ReferenceIo = {
    designRel: '.design',
    loadComments: async (f) => structuredClone(comments.get(f) ?? []),
    rewriteComments: async (f, fn) => {
      const next = fn(structuredClone(comments.get(f) ?? []));
      if (next) comments.set(f, next);
    },
    readBoard: async (f) => ({ ok: true, text: boards.get(f) ?? null }),
    applyBoardOps: async (f, ops: readonly Op[]) => {
      if (state.failBoard) return { ok: false, error: 'board exceeds the size cap' };
      const cur = parseBoard(boards.get(f) ?? '').elements;
      const r = applyOps(new Map(cur.map((e) => [e.id, e])), ops);
      boards.set(f, serializeBoard([...r.state.values()]));
      return { ok: true, changed: r.touched.size > 0 };
    },
    acceptedMode: () => state.accepted,
  };
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f) ? f : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _b, after) => {
      files.set(rel, after);
    },
    heldByAi: (_rel, el) => held.get(el) ?? null,
    log: createWriteLog(),
    references: createReferenceLanes(io),
  };
  const run = (body: unknown) => dispatchEditOp(body, deps);
  const rename = (from: string, to: string) =>
    run({
      file: FILE,
      op: 'element.set-id',
      targets: [{ artboard: 'desktop', element: from }],
      params: { id: to },
    });
  const revert = (writeId: string) =>
    run({ file: FILE, op: 'revert', targets: [], params: { writeId } });
  const snapshot = () => ({
    src: files.get(FILE),
    other: files.get(OTHER),
    comments: JSON.stringify(comments.get(KEY)),
    otherComments: JSON.stringify(comments.get(OTHER_KEY)),
    board: boards.get(KEY),
    otherBoard: boards.get(OTHER_KEY),
  });
  return { files, comments, boards, held, state, run, rename, revert, snapshot };
}

const ok = (r: EditOpResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r;
};

/** Every `el:` ref on a board text, sorted. */
const elRefs = (text: string | undefined) =>
  [...(text ?? '').matchAll(/el:desktop\/[a-z0-9-]+/g)].map((m) => m[0]).sort();

describe('element.set-id renames the id and every reference on that canvas, as one step', () => {
  test('a comment, an arrow, a stamp and a vote follow; another canvas is untouched', async () => {
    const h = harness();
    const before = h.snapshot();
    const r = ok(await h.rename('cta', 'book-call'));
    expect(r.refs).toEqual([{ artboard: 'desktop', element: 'cta' }]);
    expect(r.moved).toEqual({ comments: 1, board: 4 });

    const src = h.files.get(FILE) as string;
    expect(src).toContain('data-cd-id="book-call" href="#call"');
    expect(src).not.toContain('data-cd-id="cta"');

    const list = h.comments.get(KEY) as Array<Record<string, unknown>>;
    expect(list[0]?.selector).toBe('[data-dc-screen="desktop"] [data-cd-id="book-call"]');
    expect(list[1]?.selector).toBe('[data-cd-id="hero"]'); // another element's pin stays
    expect(list[0]?.future).toEqual({ kept: true }); // unknown keys survive the rewrite

    const els = new Map(parseBoard(h.boards.get(KEY) as string).elements.map((e) => [e.id, e]));
    expect((els.get('ar')?.endHost as { ref?: string } | undefined)?.ref).toBe(
      'el:desktop/book-call'
    );
    expect((els.get('ar')?.startHost as { ref?: string } | undefined)?.ref).toBe('ab:desktop');
    expect(els.get('vote1')?.targets).toEqual(['el:desktop/book-call', 'ab:desktop']);
    expect(els.get(ballotId('vote1', 'u_ana'))?.picks).toEqual({ 'el:desktop/book-call': 2 });
    expect(elRefs(h.boards.get(KEY))).not.toContain('el:desktop/cta');
    expect(els.get('n1')?.text).toBe('Too small?');

    // other canvases: not read, not written
    expect(h.files.get(OTHER)).toBe(before.other);
    expect(JSON.stringify(h.comments.get(OTHER_KEY))).toBe(before.otherComments);
    expect(h.boards.get(OTHER_KEY)).toBe(before.otherBoard);
  });

  test('one undo restores the source AND every reference; redo moves them again', async () => {
    const h = harness();
    const before = h.snapshot();
    const r = ok(await h.rename('cta', 'book-call'));
    const after = h.snapshot();
    const undo = ok(await h.revert(r.writeId));
    expect(h.snapshot()).toEqual(before);
    ok(await h.revert(undo.writeId)); // redo = the revert of the revert
    expect(h.snapshot()).toEqual(after);
  });

  test('undo is a rename back: a comment pinned to the new id since then goes back with it', async () => {
    const h = harness();
    const r = ok(await h.rename('cta', 'book-call'));
    h.comments.get(KEY)?.push(comment('c_late', '[data-cd-id="book-call"]'));
    ok(await h.revert(r.writeId));
    const sel = (h.comments.get(KEY) as Array<{ id: string; selector: string }>).map((c) => [
      c.id,
      c.selector,
    ]);
    expect(sel).toContainEqual(['c_late', '[data-cd-id="cta"]']);
  });
});

describe('refusals (nothing is written anywhere)', () => {
  const nothing = async (h: ReturnType<typeof harness>, r: Promise<EditOpResult>) => {
    const before = h.snapshot();
    const res = await r;
    expect(h.snapshot()).toEqual(before);
    return res;
  };

  test('a new id another element already has is refused', async () => {
    const h = harness();
    const r = await nothing(h, h.rename('cta', 'footer'));
    expect(!r.ok && [r.code, r.message]).toEqual(['invalid', ID_TAKEN_MESSAGE]);
    expect(statusOf(r)).toBe(400);
  });

  test('an id that breaks the grammar (or reads as a computed id) is refused', async () => {
    const h = harness();
    for (const bad of ['Book Call', '1st', 'a--b', 'deadbeef', 'x'.repeat(49), '']) {
      const r = await nothing(h, h.rename('cta', bad));
      expect(!r.ok && r.code).toBe('invalid');
    }
  });

  test('an element an AI run holds is refused held-by-ai', async () => {
    const h = harness();
    h.held.set('cta', { mine: true });
    const r = await nothing(h, h.rename('cta', 'book-call'));
    expect(!r.ok && r.code).toBe('held-by-ai');
    expect(statusOf(r)).toBe(409);
  });

  test('a new id an AI run already holds is refused held-by-ai', async () => {
    const h = harness();
    h.held.set('book-call', { mine: false });
    const r = await nothing(h, h.rename('cta', 'book-call'));
    expect(!r.ok && r.code).toBe('held-by-ai');
  });

  test('a locked element is refused locked', async () => {
    const h = harness();
    const r = await nothing(h, h.rename('logo', 'brand'));
    expect(!r.ok && r.code).toBe('locked');
  });

  test('a new id a detached comment still holds is refused (it would land on this element)', async () => {
    const h = harness();
    h.comments.get(KEY)?.push(comment('c_gone', '[data-cd-id="old-banner"]'));
    const r = await nothing(h, h.rename('cta', 'old-banner'));
    expect(!r.ok && [r.code, r.message]).toEqual(['invalid', ID_HELD_BY_REFERENCE_MESSAGE]);
  });

  test('accepted mode: references to move refuse the rename (three actions, not one undo)', async () => {
    const h = harness({ accepted: true });
    const r = await nothing(h, h.rename('cta', 'book-call'));
    expect(!r.ok && [r.code, r.message]).toEqual(['invalid', RENAME_SPLIT_MESSAGE]);
    // …an id nothing points at is one source write = one action, so it goes ahead
    ok(await h.rename('footer', 'site-footer'));
    expect(h.files.get(FILE)).toContain('data-cd-id="site-footer"');
  });

  test('a lane that fails mid-rename puts everything back (never a half-rename)', async () => {
    const h = harness({ failBoard: true });
    const r = await nothing(h, h.rename('cta', 'book-call'));
    expect(!r.ok && r.code).toBe('invalid');
  });
});

describe('a Maude 1 peer reads the renamed files', () => {
  test('board, comments and source stay readable by the v1 readers', async () => {
    const h = harness();
    ok(await h.rename('cta', 'book-call'));
    const text = h.boards.get(KEY) as string;
    const v1 = withFormat1Reader(() => parseBoard(text));
    expect(v1.dropped ?? []).toEqual([]);
    expect(v1.elements.map((e) => e.id).sort()).toEqual(
      parseBoard(BOARD())
        .elements.map((e) => e.id)
        .sort()
    );
    // the v1 UI still draws the bound arrow, frozen at its cached ends
    const arrow = withFormat1Reader(() => elementsToStrokes(v1.elements)).find(
      (s) => s.id === 'ar'
    );
    expect(arrow).toMatchObject({ x1: 200, y1: 60, x2: 400, y2: 60 });
    // comments: the tolerant reader keeps every key, anchors included
    const c = withSanitizedAnchors((h.comments.get(KEY) as object[])[0] as Record<string, unknown>);
    expect(c).toMatchObject({ artboard: 'desktop', future: { kept: true } });
    // source: the v1 edit engine finds the element by its new id
    const ids = listElements(FILE, h.files.get(FILE) as string).map((e) => e.id);
    expect(ids).toContain('book-call');
  });
});

describe('the route hands the reference lanes to the dispatcher', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  test('POST /_api/edit-op element.set-id writes the file and moves the references', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maude-set-id-'));
    dirs.push(root);
    const designRoot = join(root, '.design');
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    writeFileSync(join(designRoot, 'ui', 'Home.tsx'), SRC);
    const moved: Array<[string, IdRename]> = [];
    const [spec] = createEditRoutes({
      designRoot,
      designRel: '.design',
      repoRoot: root,
      emit: () => {},
      references: {
        count: async (_rel, id) => ({ ok: true, comments: id === 'cta' ? 1 : 0, board: 0 }),
        oneStep: () => true,
        rename: async (rel, r) => {
          moved.push([rel, r]);
          return { comments: 1, board: 0 };
        },
      },
    });
    const res = await (spec as { handle: (r: Request) => Promise<Response> }).handle(
      new Request('http://localhost/_api/edit-op', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          file: '.design/ui/Home.tsx',
          op: 'element.set-id',
          targets: [{ artboard: 'desktop', element: 'cta' }],
          params: { id: 'book-call' },
        }),
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).moved).toEqual({ comments: 1, board: 0 });
    expect(moved).toEqual([['ui/Home.tsx', { from: 'cta', to: 'book-call' }]]);
    expect(readFileSync(join(designRoot, 'ui', 'Home.tsx'), 'utf8')).toContain(
      'data-cd-id="book-call"'
    );
  });
});
