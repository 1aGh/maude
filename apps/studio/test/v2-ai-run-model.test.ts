// S5.9 (03 `ai-working`, `ai-done`, `ai-long`) — what the panel says about the chat's run, as pure functions.
import { describe, expect, test } from 'bun:test';
import {
  createJumpTracker,
  isFullHeight,
  jumpLabel,
  LONG_AFTER,
  toggleOverride,
} from '../client/v2/ai/jump-model.js';
import {
  changedSomething,
  clock,
  createAnnouncer,
  describeResult,
  emptyRuns,
  followUps,
  interruptedText,
  lastAssistantDigest,
  latestRun,
  reduceRuns,
  resultVerbs,
  seedRuns,
  stepsSummary,
  stepTitle,
  took,
  workingText,
} from '../client/v2/ai/run-model.js';

const run = (over: Record<string, unknown> = {}) => ({
  runId: 'r_aaaaaaaaaaaa',
  chatId: 'c1',
  origin: 'maude-chat',
  state: 'ended',
  outcome: 'done',
  createdAt: 1000,
  startedAt: 1000,
  endedAt: 42_000,
  scope: { canvas: 'Combine.tsx', artboards: ['post'] },
  touched: { 'Combine.tsx': ['post'] },
  objects: [],
  ...over,
});

const BOARDS = [
  { id: 'post', label: 'Post 1:1 · Combine 2026' },
  { id: 'story', label: 'Story 9:16 · Zapiš se' },
  { id: 'poster', label: 'A4 · plakát' },
];

describe('the chat’s runs', () => {
  test('the newest frame for a run wins, and the newest run is the one the panel talks about', () => {
    let s = emptyRuns();
    s = reduceRuns(s, { t: 'run', run: run({ runId: 'r_old', state: 'ended', createdAt: 1 }) });
    s = reduceRuns(s, { t: 'run', run: run({ runId: 'r_new', state: 'running', createdAt: 9 }) });
    s = reduceRuns(s, { t: 'run', run: run({ runId: 'r_new', state: 'ended', createdAt: 9 }) });
    expect(latestRun(s)?.runId).toBe('r_new');
    expect(latestRun(s)?.state).toBe('ended');
    // not a run frame, or no run id: ignored
    expect(reduceRuns(s, { t: 'turn-end' })).toBe(s);
    expect(reduceRuns(s, { t: 'run', run: {} })).toBe(s);
  });

  test('a snapshot adds what it does not know and closes a run the frames never saw end — never the reverse', () => {
    let s = reduceRuns(emptyRuns(), {
      t: 'run',
      run: run({ state: 'running', outcome: undefined }),
    });
    s = seedRuns(s, [run({ state: 'ended' })]);
    expect(latestRun(s)?.state).toBe('ended');
    // an older snapshot must not reopen a run a frame already ended
    const again = seedRuns(s, [run({ state: 'running', outcome: undefined })]);
    expect(again).toBe(s);
    // a run it has never seen is added
    expect(Object.keys(seedRuns(s, [run({ runId: 'r_other' })]).byId)).toHaveLength(2);
  });
});

describe('the working line says what AI is doing, in the contract’s words', () => {
  test('"AI is …" — a name, no article', () => {
    expect(workingText({ doing: 'making it greener' })).toBe('AI is making it greener');
    expect(workingText({ doing: 'Drawing the footer' })).toBe('AI is drawing the footer');
    expect(workingText({ doing: 'AI is cutting the recap' })).toBe('AI is cutting the recap');
    expect(workingText({})).toBe('AI is working');
    expect(workingText(null)).toBe('AI is working');
  });
  test('clock and duration', () => {
    expect(clock(65_000)).toBe('1:05');
    expect(took(41_000)).toBe('41 s');
    expect(took(60_000)).toBe('1 min');
    expect(took(150_000)).toBe('3 min');
  });
});

describe('the result card’s verb set, per variant', () => {
  test('a finished change: Undo first, then Keep going', () => {
    expect(resultVerbs(run())).toEqual(['Undo', 'Keep going']);
  });
  test('a run on a copy: Undo, Keep the copy', () => {
    expect(resultVerbs(run({ copyOf: { canvas: 'Combine.tsx', artboard: 'post' } }))).toEqual([
      'Undo',
      'Keep the copy',
    ]);
  });
  test('where a before/after can be shown: Undo, Compare', () => {
    expect(resultVerbs(run(), { canCompare: true })).toEqual(['Undo', 'Compare']);
  });
  test('an answer that changed nothing has no verbs (and nothing to undo)', () => {
    const answered = run({ touched: {}, objects: [] });
    expect(changedSomething(answered)).toBe(false);
    expect(resultVerbs(answered)).toEqual([]);
  });
  test('a ⌘/ ask on a picked element holds it from the start — an answer that edits nothing is still an answer', () => {
    const el = { canvas: 'Combine.tsx', artboard: 'poster', element: 'e12' };
    const asked = run({
      scope: { canvas: 'Combine.tsx', artboards: ['poster'], elements: [el] },
      touched: {},
      objects: [el],
    });
    expect(changedSomething(asked)).toBe(false);
    expect(resultVerbs(asked)).toEqual([]);
    // an element the AI changed beyond the picked one is a change
    const more = { canvas: 'Combine.tsx', artboard: 'poster', element: 'e13' };
    expect(changedSomething({ ...asked, objects: [el, more] })).toBe(true);
    // and so is any touched artboard
    expect(changedSomething({ ...asked, touched: { 'Combine.tsx': ['poster'] } })).toBe(true);
  });
  test('a run cut short offers Keep going, and Undo only if it changed anything', () => {
    expect(resultVerbs(run({ outcome: 'stopped' }))).toEqual(['Undo', 'Keep going']);
    expect(resultVerbs(run({ outcome: 'interrupted', touched: {} }))).toEqual(['Keep going']);
  });
  test('a live, failed or cancelled run has no result card', () => {
    expect(resultVerbs(run({ state: 'running', outcome: undefined }))).toEqual([]);
    expect(resultVerbs(run({ outcome: 'failed' }))).toEqual([]);
    expect(resultVerbs(run({ outcome: 'cancelled' }))).toEqual([]);
    expect(resultVerbs(null)).toEqual([]);
  });
});

describe('the AI describes the result, never itself (rule ai-describes-the-result)', () => {
  test('"Done — <artboard> is <result>." in the contract’s shape', () => {
    expect(describeResult(run(), BOARDS)).toBe('Done — Post 1:1 is updated.');
    expect(describeResult(run({ touched: { 'Combine.tsx': ['post', 'story'] } }), BOARDS)).toBe(
      'Done — Post 1:1 and Story 9:16 are updated.'
    );
    expect(
      describeResult(run({ touched: { 'Combine.tsx': ['post', 'story', 'poster'] } }), BOARDS)
    ).toBe('Done — Post 1:1, Story 9:16 and A4 are updated.');
    expect(
      describeResult(run({ touched: {}, scope: { canvas: 'x', artboards: '*' } }), BOARDS)
    ).toBe('Done — the canvas is updated.');
  });
  test('no sentence we write starts with "I"', () => {
    for (const s of [
      describeResult(run(), BOARDS),
      interruptedText(run({ outcome: 'stopped' })),
      interruptedText(run({ outcome: 'interrupted', touched: {} })),
    ]) {
      expect(s).not.toMatch(/^I\b|\bI (made|have|'ve|did)\b/);
    }
  });
  test('a stopped run keeps what it already changed and says so', () => {
    expect(interruptedText(run({ outcome: 'stopped' }))).toBe(
      'Stopped — the changes AI already made are on the canvas.'
    );
    expect(interruptedText(run({ outcome: 'interrupted', touched: {} }))).toBe(
      'Interrupted — nothing was changed.'
    );
  });
});

describe('follow-ups and the steps fold', () => {
  test('"Same on <another artboard>" after a one-artboard change — ONE, as 03 ai-done draws it', () => {
    expect(followUps(run(), BOARDS)).toEqual(['Same on Story 9:16']);
    expect(followUps(run({ touched: { 'Combine.tsx': ['post', 'story'] } }), BOARDS)).toEqual([]);
    expect(followUps(run({ outcome: 'stopped' }), BOARDS)).toEqual([]);
    expect(followUps(run({ touched: {} }), BOARDS)).toEqual([]);
  });
  test('"What AI did · 6 steps · 41 s"', () => {
    const six = Array.from({ length: 6 }, (_, i) => `step ${i}`);
    expect(stepsSummary(six, run({ startedAt: 1000, endedAt: 42_000 }))).toBe(
      'What AI did · 6 steps · 41 s'
    );
    expect(stepsSummary(['one'], run({ startedAt: 1000, endedAt: 61_000 }))).toBe(
      'What AI did · 1 step · 1 min'
    );
    expect(stepsSummary(['one'], null)).toBe('What AI did · 1 step');
  });
  test('the last reply: its words and one title per tool call', () => {
    const d = lastAssistantDigest([
      { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolName: 'Edit', args: { path: '/a/b/Post.tsx' } },
          { type: 'tool-call', toolName: 'Bash', args: { description: 'Rebuild the preview' } },
          { type: 'text', text: 'Done — Post 1:1 is greener.' },
        ],
      },
    ]);
    expect(d.text).toBe('Done — Post 1:1 is greener.');
    expect(d.steps).toEqual(['Edit Post.tsx', 'Rebuild the preview']);
    expect(stepTitle({ toolName: 'Read', args: {} })).toBe('Read');
    expect(lastAssistantDigest([])).toEqual({ text: '', steps: [] });
  });
});

describe('the live region announces each state once', () => {
  test('a state is read once; a repeat frame, a re-render and a steps update are not', () => {
    const a = createAnnouncer();
    const working = run({ state: 'running', outcome: undefined, doing: 'making it greener' });
    expect(a.next(working)).toBe('AI is making it greener');
    expect(a.next({ ...working })).toBeNull();
    expect(a.next({ ...working, touched: { 'Combine.tsx': ['post'] } })).toBeNull();
    const done = run({ state: 'ended', outcome: 'done' });
    expect(a.next(done, 'Done — Post 1:1 is greener.')).toBe('Done — Post 1:1 is greener.');
    expect(a.next(done, 'Done — Post 1:1 is greener.')).toBeNull();
  });
  test('Needs you, then running again, are each a state', () => {
    const a = createAnnouncer();
    const base = run({ state: 'running', outcome: undefined, doing: 'drawing the footer' });
    expect(a.next(base)).toBe('AI is drawing the footer');
    expect(a.next({ ...base, state: 'needs-you', question: 'Replace the footer?' })).toBe(
      'Needs you — Replace the footer?'
    );
    expect(a.next(base)).toBe('AI is drawing the footer');
  });
  test('a stopped run is announced; a failed one is left to the problem card', () => {
    const a = createAnnouncer();
    expect(a.next(run({ outcome: 'stopped' }))).toBe(
      'Stopped — the changes AI already made are on the canvas.'
    );
    expect(createAnnouncer().next(run({ outcome: 'failed' }))).toBeNull();
    expect(createAnnouncer().next(null)).toBeNull();
  });
});

describe('Jump to latest · N new', () => {
  test('hidden at the bottom; appears once you read earlier turns; counts what arrived since', () => {
    const t = createJumpTracker();
    expect(t.update({ distance: 0, total: 10 })).toEqual({ visible: false, newCount: 0 });
    expect(t.update({ distance: 400, total: 10 })).toEqual({ visible: true, newCount: 0 });
    expect(t.update({ distance: 400, total: 12 })).toEqual({ visible: true, newCount: 2 });
    expect(t.update({ distance: 400, total: 13 }).newCount).toBe(3);
    // back at the bottom: gone, and the next time away starts the count again
    expect(t.update({ distance: 10, total: 13 })).toEqual({ visible: false, newCount: 0 });
    expect(t.update({ distance: 300, total: 13 }).newCount).toBe(0);
  });
  test('growing while you are at the bottom never raises the pill', () => {
    const t = createJumpTracker();
    for (let n = 5; n < 15; n++) expect(t.update({ distance: 0, total: n }).visible).toBe(false);
  });
  test('a nudge of a line is not "reading earlier"', () => {
    const t = createJumpTracker();
    expect(t.update({ distance: 70, total: 4 }).visible).toBe(false);
  });
  test('the label', () => {
    expect(jumpLabel(2)).toEqual({ text: 'Jump to latest', count: '2 new' });
    expect(jumpLabel(0)).toEqual({ text: 'Jump to latest', count: '' });
  });
});

describe('the panel’s height', () => {
  test('a long chat takes the full height on its own; a short one does not', () => {
    expect(isFullHeight({ total: LONG_AFTER - 1 })).toBe(false);
    expect(isFullHeight({ total: LONG_AFTER })).toBe(true);
  });
  test('double-click flips what is showing, and the choice beats the length', () => {
    expect(toggleOverride(true)).toBe('compact');
    expect(toggleOverride(false)).toBe('full');
    expect(isFullHeight({ override: 'compact', total: 50 })).toBe(false);
    expect(isFullHeight({ override: 'full', total: 1 })).toBe(true);
  });
});
