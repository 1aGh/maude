// P8 c10 (03 `ai-long`, `ai-long-pinned`): the result card is drawn on OLDER turns too — each finished turn that
// changed the canvas keeps its Before / After, Undo / Compare and "What AI did" fold, not only the chat's latest run.
import { describe, expect, test } from 'bun:test';
import {
  changedSomething,
  partSteps,
  runIsFromEarlierTurn,
  turnCardVerbs,
  turnRunFor,
} from '../client/v2/ai/run-model.js';
import { beforeAfterOf } from '../client/v2/ai/run-compare.js';
import { shortArtboardName } from '../client/v2/ai/scope.js';
import { reduceRows } from '../client/v2/history/rows';

const T = 1_700_000_000_000;
const MIN = 60_000;
const run = (id: string, over: Record<string, unknown> = {}) => ({
  runId: id,
  state: 'ended',
  outcome: 'done',
  createdAt: T,
  touched: { 'ui/a.tsx': ['post'] },
  scope: { canvas: 'ui/a.tsx', artboards: ['post'] },
  ...over,
});

describe('which run was this turn', () => {
  const runs = [
    run('r_1', { createdAt: T + 1_000 }),
    run('r_2', { createdAt: T + 60_000 }),
    run('r_3', { createdAt: T + 120_000 }),
  ];
  test('the run created after the ask and before the next ask', () => {
    expect(turnRunFor(runs, T, T + 50_000)?.runId).toBe('r_1');
    expect(turnRunFor(runs, T + 50_000, T + 100_000)?.runId).toBe('r_2');
  });
  test('the last ask has no next ask: its run is the one after it', () => {
    expect(turnRunFor(runs, T + 110_000, null)?.runId).toBe('r_3');
  });
  test('a run created a moment before the ask time stamp still belongs to it (clock skew)', () => {
    expect(turnRunFor([run('r_s', { createdAt: T - 2_000 })], T, null)?.runId).toBe('r_s');
  });
  test('no time known, no run: nothing is guessed', () => {
    expect(turnRunFor(runs, null, null)).toBeNull();
    expect(turnRunFor([], T, null)).toBeNull();
    expect(turnRunFor(runs, T + 200_000, null)).toBeNull();
  });
});

describe('who owns a result: the tail of the feed or its own reply', () => {
  test('a run from before the last ask lives under its reply; the last ask’s run stays at the tail', () => {
    expect(runIsFromEarlierTurn(run('r', { createdAt: T }), T + 20 * MIN)).toBe(true);
    expect(runIsFromEarlierTurn(run('r', { createdAt: T + 20 * MIN + 2_000 }), T + 20 * MIN)).toBe(
      false
    );
    expect(runIsFromEarlierTurn(run('r'), null)).toBe(false);
  });
});

describe('the older turn’s verbs', () => {
  test('Undo + Compare where there is a Before; Undo alone otherwise — never "Keep going"', () => {
    expect(turnCardVerbs(run('r'), { canCompare: true })).toEqual(['Undo', 'Compare']);
    expect(turnCardVerbs(run('r'), { canCompare: false })).toEqual(['Undo']);
  });
  test('a copy keeps its own verb; an answer has no card', () => {
    expect(turnCardVerbs(run('r', { copyOf: { artboard: 'x' } }), {})).toEqual([
      'Undo',
      'Keep the copy',
    ]);
    expect(turnCardVerbs(run('r', { touched: {} }), {})).toEqual([]);
    expect(changedSomething(run('r', { touched: {} }))).toBe(false);
  });
  test('a cut-short turn offers Undo too, still no Keep going', () => {
    expect(turnCardVerbs(run('r', { outcome: 'stopped' }), {})).toEqual(['Undo']);
  });
});

describe('the scope chip of a copy (03 `ai-copy`: "Post 1:1 · copy")', () => {
  test('a copy keeps its "· copy" tail; an original is still cut at the first " · "', () => {
    expect(shortArtboardName('Post 1:1 · Combine 2026 · copy')).toBe('Post 1:1 · copy');
    expect(shortArtboardName('Post 1:1 · copy')).toBe('Post 1:1 · copy');
    expect(shortArtboardName('Post 1:1 · Combine 2026')).toBe('Post 1:1');
    const long = shortArtboardName('Pozvánka na zimní soustředění mládeže 2026 · A4 · copy');
    expect(long.length).toBeLessThanOrEqual(28);
    expect(long.endsWith(' · copy')).toBe(true);
  });
});

describe('the versions list names the run of each AI row (Before / After needs it)', () => {
  const v = (rev: number, kind: string, extra: Record<string, unknown> = {}) => ({
    rev,
    actionId: `a${rev}`,
    actor: 'me',
    mine: true,
    kind,
    label: null,
    madeAt: T + rev * 3_600_000,
    canvas: 'ui/a.tsx',
    artboards: ['post'],
    changes: [],
    alsoOn: 0,
    ...extra,
  });
  test('an AI row carries its runId, and beforeAfterOf finds it and skips an undo row', () => {
    const rows = reduceRows([
      v(1, 'edit'),
      v(2, 'ai', { runId: 'r_story1', chatId: 'long1' }),
      v(3, 'undo', { undoVia: 'panel', undoes: ['a2'] }),
      v(4, 'ai', { runId: 'r_story2', chatId: 'long1' }),
    ] as never);
    expect(rows.find((r) => r.kind === 'ai' && r.id === 'a2')?.runId).toBe('r_story1');
    const { after, before } = beforeAfterOf(rows, 'r_story2');
    expect(after?.id).toBe('a4');
    expect(before?.id).toBe('a2'); // the undo row between them is not a "before"
  });
});

describe('the steps of an older turn', () => {
  test('one title per tool call of that reply', () => {
    const steps = partSteps([
      { type: 'text', text: 'Done.' },
      { type: 'tool-call', toolName: 'Edit', args: { file_path: 'ui/Post.tsx' } },
      { type: 'tool-call', toolName: 'Bash', args: { description: 'Rebuild the preview' } },
    ]);
    expect(steps).toEqual(['Edit Post.tsx', 'Rebuild the preview']);
  });
  test('no parts, no steps', () => {
    expect(partSteps(undefined)).toEqual([]);
  });
});
