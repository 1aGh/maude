// S5.11 — what the ✦ N, the run list, the waiting card and the artboard rings read out of the run registry.
// Pure model: the rules are asserted here, the DOM in v2-ai-runs-ui.test.tsx.
import { describe, expect, test } from 'bun:test';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import {
  canvasRows,
  doneRings,
  estimateFor,
  mergeRings,
  needsYouCount,
  normalizeRuns,
  ringsFor,
  waitEstimate,
  waitingCopy,
  waitingOfChat,
  whereLabel,
  yoursCount,
  yoursRows,
} from '../client/v2/ai/runs-model.js';

const FILE = '.design/ui/combine.tsx';
const KEY = `path:${FILE}`;
const lease = (artboard: string) => ({ canvas: KEY, artboard, token: 1 });
const labels = new Map([
  [
    FILE,
    [
      { id: 'post', label: 'Post 1:1' },
      { id: 'poster', label: 'A4 · plakát' },
      { id: 'story', label: 'Story 9:16' },
    ],
  ],
]);

let n = 0;
const mine = (over: Record<string, unknown>) => ({
  v: 1,
  runId: `r_${++n}aaaaaa`,
  askId: `a_${n}aaaaaa`,
  chatId: `c${n}`,
  origin: 'maude-chat',
  actor: 'you',
  device: 'mac',
  label: 'Make it greener',
  scope: { canvas: 'ui/combine.tsx', artboards: ['post'] },
  state: 'running',
  leases: [lease('post')],
  waiting: [],
  touched: {},
  objects: [],
  createdAt: n,
  ...over,
});
const other = (over: Record<string, unknown>) => ({
  runId: `r_${++n}bbbbbb`,
  askId: null,
  actor: 'tereza',
  origin: 'maude-chat',
  label: 'Shorter headline',
  state: 'running',
  artboards: [{ canvas: KEY, artboard: 'story' }],
  waitingFor: [],
  objects: [],
  since: 1,
  ...over,
});
const view = (m: unknown[], o: unknown[] = []) => normalizeRuns({ seq: 4, mine: m, others: o });

describe('✦ N counts only YOUR live runs', () => {
  test('a waiting ask counts; an ended run and Tereza never do', () => {
    const v = view(
      [
        mine({ state: 'running' }),
        mine({ state: 'running', leases: [lease('poster')] }),
        mine({ state: 'ended', outcome: 'done', leases: [] }),
        mine({
          state: 'waiting',
          leases: [],
          waiting: [{ ...lease('post'), position: 1, heldBy: null }],
        }),
      ],
      [other({}), other({ state: 'needs-you' })]
    );
    expect(yoursCount(v)).toBe(3);
  });

  test('two chats on two artboards is 2, with Tereza on the canvas too', () => {
    expect(yoursCount(view([mine({}), mine({ leases: [lease('poster')] })], [other({})]))).toBe(2);
  });

  test('zero without any run, and for an old server that answers nothing', () => {
    expect(yoursCount(view([]))).toBe(0);
    expect(yoursCount(normalizeRuns(null))).toBe(0);
    expect(yoursCount(normalizeRuns({ mine: 'nope', others: {} }))).toBe(0);
  });

  test('needs-you is counted from yours only', () => {
    const v = view([mine({ state: 'needs-you' }), mine({})], [other({ state: 'needs-you' })]);
    expect(needsYouCount(v)).toBe(1);
  });
});

describe('the run list rows', () => {
  test('Yours: state words, artboard names, the current chat', () => {
    const a = mine({ chatId: 'c-a', label: 'Make it greener' });
    const b = mine({
      chatId: 'c-b',
      label: 'Translate the poster',
      leases: [lease('poster')],
      scope: { canvas: 'ui/combine.tsx', artboards: ['poster'] },
      state: 'needs-you',
    });
    const rows = yoursRows(view([a, b]), { designRel: '.design', labels, currentChatId: 'c-b' });
    expect(rows.map((r: { where: string }) => r.where)).toEqual(['Post 1:1', 'A4 · plakát']);
    expect(rows.map((r: { state: string }) => r.state)).toEqual(['working', 'needs']);
    expect(rows.map((r: { current: boolean }) => r.current)).toEqual([false, true]);
    expect(rows[0].file).toBe(FILE);
    expect(rows[0].artboard).toBe('post');
  });

  test('a whole-canvas ask reads "Whole canvas"', () => {
    const r = mine({
      scope: { canvas: 'ui/combine.tsx', artboards: '*' },
      leases: [lease('post'), lease('poster'), lease('story')],
    });
    expect(whereLabel(r, { designRel: '.design', labels })).toBe('Whole canvas');
  });

  test('On this canvas: Tereza, View only, only the open canvas', () => {
    const elsewhere = other({
      artboards: [{ canvas: 'path:.design/ui/other.tsx', artboard: 'x' }],
    });
    const t = other({});
    const rows = canvasRows(view([mine({})], [t, elsewhere]), {
      activeCanvas: FILE,
      designRel: '.design',
      labels,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].viewOnly).toBe(true);
    expect(rows[0].who).toBe('tereza');
    expect(rows[0].where).toBe("Story 9:16 · Tereza's AI");
    expect(rows[0].state).toBe('working');
  });

  // 03 `ai-tereza` on a real hub: a member's actor is her hub identity (the token owner's e-mail). The row names
  // her, never prints the e-mail (the hook's rule too, agent-runs-hooks.test.ts).
  test('a hub member is named by her e-mail local part, never the e-mail itself', () => {
    const rows = canvasRows(view([mine({})], [other({ actor: 'tereza@x.test' })]), {
      activeCanvas: FILE,
      designRel: '.design',
      labels,
    });
    expect(rows[0].where).toBe("Story 9:16 · Tereza's AI");
    expect(rows[0].where).not.toContain('@');
  });

  test('a person waiting in line on this canvas is listed too', () => {
    const w = other({
      state: 'waiting',
      artboards: [],
      waitingFor: [{ canvas: KEY, artboard: 'post', position: 1 }],
    });
    const rows = canvasRows(view([], [w]), { activeCanvas: FILE, designRel: '.design', labels });
    expect(rows.map((r: { state: string }) => r.state)).toEqual(['waiting']);
  });
});

describe('the rings the canvas draws (dgn ai-runs)', () => {
  test('two chats on two artboards: both ringed, yours say AI is working', () => {
    const v = view([mine({}), mine({ leases: [lease('poster')] })]);
    expect(ringsFor(v, { activeCanvas: FILE })).toEqual({
      post: { state: 'running', who: 'you', tag: 'AI is working', waiting: 0 },
      poster: { state: 'running', who: 'you', tag: 'AI is working', waiting: 0 },
    });
  });

  test('P8 t-ai (14 ed-edge-ask): a run on a selection wears no artboard ring - its outline is the one on the elements; a question still rings', () => {
    const el = (e: string) => ({ canvas: KEY, artboard: 'post', element: e });
    const inPlace = mine({
      scope: {
        canvas: 'ui/combine.tsx',
        artboards: ['post'],
        elements: [el('card-1'), el('card-2')],
      },
      leases: [lease('post')],
    });
    expect(ringsFor(view([inPlace]), { activeCanvas: FILE })).toEqual({});
    // the same run, waiting for you: the artboard it asks about is ringed (azure)
    const asking = { ...inPlace, state: 'needs-you' };
    expect(ringsFor(view([asking]), { activeCanvas: FILE }).post?.state).toBe('needs-you');
    // an ask on the artboard itself is unchanged
    expect(ringsFor(view([mine({})]), { activeCanvas: FILE }).post?.state).toBe('running');
  });

  test("Tereza's run: her name leads the tag; another canvas gets no ring", () => {
    const v = view(
      [],
      [other({}), other({ artboards: [{ canvas: 'path:.design/ui/other.tsx', artboard: 'z' }] })]
    );
    expect(ringsFor(v, { activeCanvas: FILE })).toEqual({
      story: { state: 'running', who: 'tereza', tag: "Tereza's AI", waiting: 0 },
    });
  });

  test('a second ask on the busy artboard is "· N waiting" on the holder and has no ring of its own', () => {
    const holder = mine({});
    const w = (position: number) =>
      mine({
        state: 'waiting',
        leases: [],
        waiting: [{ ...lease('post'), position, heldBy: null }],
      });
    const t = other({
      state: 'waiting',
      artboards: [],
      waitingFor: [{ canvas: KEY, artboard: 'post', position: 3 }],
    });
    const rings = ringsFor(view([holder, w(1), w(2)], [t]), { activeCanvas: FILE });
    expect(Object.keys(rings)).toEqual(['post']);
    expect(rings.post.waiting).toBe(3);
  });

  test('needs you: yours "Waiting for you", hers "Waiting for Tereza" — both azure states', () => {
    const v = view([mine({ state: 'needs-you' })], [other({ state: 'needs-you' })]);
    const rings = ringsFor(v, { activeCanvas: FILE });
    expect(rings.post).toEqual({
      state: 'needs-you',
      who: 'you',
      tag: 'Waiting for you',
      waiting: 0,
    });
    expect(rings.story).toEqual({
      state: 'needs-you',
      who: 'tereza',
      tag: 'Waiting for Tereza',
      waiting: 0,
    });
  });

  test('needs you on a whole-canvas ask rings only what the run touched, never every artboard (03 ai-permission, ai-question)', () => {
    const whole = (over: Record<string, unknown>) =>
      mine({
        state: 'needs-you',
        scope: { canvas: 'ui/combine.tsx', artboards: '*' },
        leases: [lease('post'), lease('poster'), lease('story')],
        ...over,
      });
    // a question before anything changed: no artboard is "waiting for you"
    expect(ringsFor(view([whole({})]), { activeCanvas: FILE })).toEqual({});
    // a permission after the run changed one: that one carries the ring
    const rings = ringsFor(view([whole({ touched: { 'ui/combine.tsx': ['poster'] } })]), {
      activeCanvas: FILE,
    });
    expect(Object.keys(rings)).toEqual(['poster']);
    expect(rings.poster.state).toBe('needs-you');
    // running is unchanged: the whole canvas is held
    expect(
      Object.keys(ringsFor(view([whole({ state: 'running' })]), { activeCanvas: FILE })).sort()
    ).toEqual(['post', 'poster', 'story']);
  });

  test('the ring data has no prompt text: not the ask, the question or the progress line', () => {
    const secret = 'SECRET-PROMPT-TEXT';
    const v = view(
      [
        mine({
          label: secret,
          prompt: secret,
          question: `${secret} question`,
          doing: `${secret} doing`,
          state: 'needs-you',
        }),
        mine({ label: secret, leases: [lease('poster')], doing: secret }),
      ],
      [other({ label: secret })]
    );
    const rings = ringsFor(v, { activeCanvas: FILE });
    expect(JSON.stringify(rings)).not.toContain('SECRET');
    expect(JSON.stringify(rings)).not.toContain('Make it greener');
    for (const r of Object.values(rings) as object[])
      expect(Object.keys(r).sort()).toEqual(['state', 'tag', 'waiting', 'who']);
  });

  test('a finished run: the settled ring, and a live ring wins its artboard', () => {
    const live = ringsFor(view([mine({})]), { activeCanvas: FILE });
    const merged = mergeRings(live, doneRings(['post', 'poster']));
    expect(merged.post.state).toBe('running');
    expect(merged.poster).toEqual({ state: 'done', who: 'you', tag: 'Made by AI', waiting: 0 });
  });
});

describe('the waiting card words', () => {
  const holder = other({
    runId: 'r_holder1',
    label: 'Make it greener',
    state: 'running',
    artboards: [{ canvas: KEY, artboard: 'post' }],
    since: 1_000,
  });
  const waiting = mine({
    state: 'waiting',
    chatId: 'c-w',
    label: 'Headline in one word',
    leases: [],
    waiting: [{ ...lease('post'), position: 1, heldBy: holder }],
  });

  test('names the holder and the artboard; says it starts by itself', () => {
    const c = waitingCopy(waiting, { designRel: '.design', labels });
    expect(c.title).toBe('Waiting for “Make it greener” to finish on Post 1:1.');
    expect(c.detail).toBe('Starts by itself, on top of its result.');
  });

  test('no estimate unless one was computed — never a made-up "about a minute"', () => {
    expect(waitingCopy(waiting, { designRel: '.design', labels }).detail).not.toMatch(
      /about|minute|—/
    );
    expect(
      waitingCopy(waiting, { designRel: '.design', labels, estimate: null }).detail
    ).not.toMatch(/minute/);
    expect(
      waitingCopy(waiting, { designRel: '.design', labels, estimate: 'about a minute' }).detail
    ).toBe('Starts by itself, on top of its result — about a minute.');
  });

  test('the estimate comes from the holder elapsed and the median turn; absent without history', () => {
    expect(waitEstimate({ elapsedMs: 10_000, medianMs: 70_000 })).toBe('about a minute');
    expect(waitEstimate({ elapsedMs: 0, medianMs: 200_000 })).toBe('about 3 minutes');
    expect(waitEstimate({ elapsedMs: 50_000, medianMs: 70_000 })).toBe('under a minute');
    expect(waitEstimate({ elapsedMs: 90_000, medianMs: 70_000 })).toBeNull(); // overdue: no number
    expect(waitEstimate({ elapsedMs: 5, medianMs: null })).toBeNull();
    expect(waitEstimate({})).toBeNull();
  });

  test('estimateFor needs the holder to be YOUR run with two finished turns in its chat', () => {
    const myHolder = mine({ runId: 'r_myholder', chatId: 'c-h', startedAt: 0, state: 'running' });
    const turn = (ms: number) =>
      mine({
        chatId: 'c-h',
        state: 'ended',
        outcome: 'done',
        leases: [],
        startedAt: 0,
        endedAt: ms,
      });
    const w = mine({
      state: 'waiting',
      chatId: 'c-w',
      leases: [],
      waiting: [
        { ...lease('post'), position: 1, heldBy: { ...holder, runId: 'r_myholder', since: 0 } },
      ],
    });
    expect(estimateFor(view([myHolder, turn(60_000), turn(80_000), w]), w, 10_000)).toBe(
      'about a minute'
    );
    expect(estimateFor(view([myHolder, turn(60_000), w]), w, 10_000)).toBeNull(); // one turn is no median
    expect(estimateFor(view([w], [holder]), waiting, 10_000)).toBeNull(); // somebody else's chat
  });

  test('waitingOfChat is that chat only, in the order asked', () => {
    const a = mine({ state: 'waiting', chatId: 'c1', leases: [], createdAt: 5 });
    const b = mine({ state: 'waiting', chatId: 'c1', leases: [], createdAt: 2 });
    const c = mine({ state: 'waiting', chatId: 'c2', leases: [] });
    expect(
      waitingOfChat(view([a, b, c]), 'c1').map((r: { createdAt: number }) => r.createdAt)
    ).toEqual([2, 5]);
  });
});

describe('dgn `ai-runs` (the bridge row the rings travel on)', () => {
  const row = (
    DGN_TABLE.s2c as Record<
      string,
      { gate: string; parse: (r: Record<string, unknown>) => unknown }
    >
  )['ai-runs'];
  const ring = { state: 'running', who: 'you', tag: 'AI is working', waiting: 0 };

  test('parent-gated, and what ringsFor builds is exactly what it accepts', () => {
    expect(row.gate).toBe('parent');
    const rings = ringsFor(
      view([mine({}), mine({ leases: [lease('poster')], state: 'needs-you' })], [other({})]),
      { activeCanvas: FILE }
    );
    expect(row.parse({ artboards: rings })).toEqual({ artboards: rings });
    expect(row.parse({ artboards: {} })).toEqual({ artboards: {} });
  });

  test('refuses a planted payload whole: bad state, long tag, odd count, __proto__, too many', () => {
    expect(row.parse({ artboards: { a: { ...ring, state: 'bold' } } })).toBeNull();
    expect(row.parse({ artboards: { a: { ...ring, tag: 'x'.repeat(121) } } })).toBeNull();
    expect(row.parse({ artboards: { a: { ...ring, waiting: 1.5 } } })).toBeNull();
    expect(row.parse({ artboards: { a: { ...ring, waiting: 1e9 } } })).toBeNull();
    expect(row.parse({ artboards: { a: { ...ring, extra: 'x' } } })).toEqual({
      artboards: { a: ring },
    }); // unknown keys are dropped
    const planted = JSON.parse(
      '{"__proto__": {"state":"running","who":"a","tag":"b","waiting":0}}'
    );
    expect(row.parse({ artboards: planted })).toBeNull();
    expect(row.parse({ artboards: 'nope' })).toBeNull();
    expect(row.parse({})).toBeNull();
    const many = Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`ab${i}`, ring]));
    expect(row.parse({ artboards: many })).toBeNull();
  });
});
