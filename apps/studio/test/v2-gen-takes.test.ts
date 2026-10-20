// v2-gen-takes.test.ts — S8.16b, the client half of Generate with N takes (12 · ia-gen-ask, ia-gen-placed).
//
//   · the registry: ← → are `image.next-take` / `image.prev-take` in the shell while `selectionHasTakes` holds, and
//     `object.nudge` yields them in the canvas then (and only then);
//   · the canvas half (editing/take-keys.ts): a selected picture in the shell's `gen-takes` set turns ← → into a
//     `take-step`; the bridge parsers refuse a planted list;
//   · the shell half (client/v2/assets/takes.js): one `/of` ask per picture, a step is the `image.replace` edit-op aimed
//     at the neighbouring take, with its undo payload; `take-step` is honoured only from the focused active canvas;
//   · the ask (generate-ask.jsx): no run without the quote, the best take is placed (`mode: 'auto'`), the toast words.

import { beforeEach, describe, expect, test } from 'bun:test';

import { canvasKeyCtx, shellKeyCtx } from '../actions/ctx.ts';
import { documentIndex } from '../actions/documents.ts';
import { ACTIONS } from '../actions/index.ts';
import { resolveChord } from '../actions/resolve.ts';
import { c2sSpec, GEN_TAKES_ASSETS_MAX, s2cSpec } from '../bridge/dgn-protocol.ts';
import { askQuote, placedLine, runGenerate } from '../client/v2/assets/generate-ask.jsx';
import {
  primeTakes,
  resetTakes,
  selectedPicture,
  selectionHasTakes,
  stepTake,
  takeAssetsOf,
  takesOf,
} from '../client/v2/assets/takes.js';
import { acceptTakeStep } from '../client/v2/assets/use-takes-lane.js';
import { setTakeAssets, takeStepOf } from '../editing/take-keys.ts';

const A = 'assets/aaaaaaaa.png';
const B = 'assets/bbbbbbbb.png';
const C = 'assets/cccccccc.png';
const CANVAS = 'ui/gameweek.tsx';
const REF = { artboard: 'post', element: 'hero' };
const pic = (asset: string) => ({ id: 'hero', artboardId: 'post', photoAsset: asset, refs: [REF] });

type Call = { url: string; init?: RequestInit };
function fakeFetch(answer: (url: string, init?: RequestInit) => unknown, calls: Call[] = []) {
  return (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const out = answer(url, init) as { status?: number; body: unknown };
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200 });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  resetTakes();
  setTakeAssets([]);
});

describe('registry (S8.16b)', () => {
  const shellIndex = documentIndex(ACTIONS, 'shell', () => true);
  const canvasIndex = documentIndex(ACTIONS, 'canvas', () => true);
  const shellState = (selectionHasTakes: boolean) => ({
    canvasOpen: true,
    timelineVisible: false,
    presenting: false,
    native: false,
    readOnly: false,
    clipSelected: false,
    artboardSelected: false,
    commentFocused: false,
    selectionHasTakes,
  });

  test('← → in the shell are the take steps only while the selection has takes', () => {
    const on = shellKeyCtx({ tag: 'BODY' }, shellState(true));
    expect(resolveChord(shellIndex, '→', on)?.action.id).toBe('image.next-take');
    expect(resolveChord(shellIndex, '←', on)?.action.id).toBe('image.prev-take');
    const off = shellKeyCtx({ tag: 'BODY' }, shellState(false));
    expect(resolveChord(shellIndex, '→', off)?.action.id).not.toBe('image.next-take');
    // typing in a field keeps the arrows
    const typing = shellKeyCtx({ tag: 'INPUT' }, shellState(true));
    expect(resolveChord(shellIndex, '→', typing)?.action.id).not.toBe('image.next-take');
  });

  test('object.nudge yields ← → in the canvas to a picture with takes; ⇧← still nudges', () => {
    const ctx = (selectionHasTakes: boolean) =>
      canvasKeyCtx({ typing: false, readOnly: false, selection: 'object', selectionHasTakes });
    expect(resolveChord(canvasIndex, '→', ctx(false))?.action.id).toBe('object.nudge');
    expect(resolveChord(canvasIndex, '→', ctx(true))?.action.id).not.toBe('object.nudge');
    expect(resolveChord(canvasIndex, '⇧←', ctx(true))?.action.id).toBe('object.nudge');
  });
});

describe('canvas half — editing/take-keys.ts', () => {
  const key = (k: string, shift = false) => ({ key: k, shiftKey: shift });
  const s = (asset: string | null, mode: 'edit' | 'preview' = 'edit') => ({
    typing: false,
    mode,
    selection: 'object' as const,
    asset,
  });

  test('a picture in the gen-takes set: → next, ← prev; otherwise nothing', () => {
    expect(takeStepOf(key('ArrowRight'), s(A))).toBeNull(); // the set is empty
    setTakeAssets([A, B]);
    expect(takeStepOf(key('ArrowRight'), s(A))).toBe('next');
    expect(takeStepOf(key('ArrowLeft'), s(B))).toBe('prev');
    expect(takeStepOf(key('ArrowRight'), s(C))).toBeNull(); // not a take
    expect(takeStepOf(key('ArrowUp'), s(A))).toBeNull();
    expect(takeStepOf(key('ArrowRight', true), s(A))).toBeNull(); // ⇧→ nudges 10
    expect(takeStepOf(key('ArrowRight'), s(A, 'preview'))).toBeNull();
    expect(takeStepOf(key('ArrowRight'), { ...s(A), typing: true })).toBeNull();
  });

  test('the bridge refuses a planted gen-takes list and a bad take-step', () => {
    const gen = s2cSpec('gen-takes');
    expect(gen?.gate).toBe('parent');
    expect(gen?.parse({ dgn: 'gen-takes', assets: [A, B] })).toEqual({ assets: [A, B] });
    expect(gen?.parse({ dgn: 'gen-takes', assets: ['../../etc/passwd'] })).toBeNull();
    expect(gen?.parse({ dgn: 'gen-takes', assets: [`/${A}`] })).toBeNull();
    const many = Array.from({ length: GEN_TAKES_ASSETS_MAX + 1 }, () => A);
    expect(gen?.parse({ dgn: 'gen-takes', assets: many })).toBeNull();
    const step = c2sSpec('take-step');
    expect(step?.gate).toBe('active');
    expect(step?.parse({ dgn: 'take-step', dir: 'next' })).toEqual({ dir: 'next' });
    expect(step?.parse({ dgn: 'take-step', dir: 'sideways' })).toBeNull();
    // the canvas names a direction, never an asset: anything else is dropped
    expect(step?.parse({ dgn: 'take-step', dir: 'next', asset: B })).toEqual({ dir: 'next' });
  });
});

describe('shell half — client/v2/assets/takes.js', () => {
  const ofAnswer = {
    ok: true,
    takes: [A, B, C],
    index: 0,
    of: 3,
    label: 'Take 1 of 3',
    madeByAi: { prompt: 'p' },
  };

  test('one /of ask per picture; the set names every take; the fact follows', async () => {
    const calls: Call[] = [];
    const f = fakeFetch(() => ({ body: ofAnswer }), calls);
    expect(selectionHasTakes(pic(A), CANVAS)).toBe(false);
    await Promise.all([takesOf(CANVAS, A, { fetch: f }), takesOf(CANVAS, A, { fetch: f })]);
    await takesOf(CANVAS, A, { fetch: f });
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toContain('/_api/generate-takes/of?');
    expect(calls[0]?.url).toContain(`canvas=${encodeURIComponent(CANVAS)}`);
    expect(takeAssetsOf(CANVAS)).toEqual([A, B, C]);
    expect(takeAssetsOf('ui/other.tsx')).toEqual([]);
    expect(selectionHasTakes(pic(A), CANVAS)).toBe(true);
    expect(selectionHasTakes([pic(A), pic(B)], CANVAS)).toBe(false); // one picture only
  });

  test('a step is image.replace aimed at the neighbour, recorded once, wrapping round', async () => {
    primeTakes(CANVAS, [A, B, C], null);
    const calls: Call[] = [];
    const records: unknown[] = [];
    const f = fakeFetch(() => ({ body: { ok: true, writeId: 'w1' } }), calls);
    const r = await stepTake('prev', {
      canvas: CANVAS,
      selected: pic(A),
      fetch: f,
      record: (p: unknown) => records.push(p),
    });
    expect(r).toEqual({ ok: true, asset: C, label: 'Take 3 of 3' });
    expect(calls[0]?.url).toBe('/_api/edit-op');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      file: CANVAS,
      op: 'image.replace',
      targets: [REF],
      params: { asset: C },
    });
    expect(records).toEqual([{ op: 'edit-op', writeId: 'w1', label: 'Take 3 of 3' }]);
    // the canvas has not re-selected yet: the shell's selection still names A, the frame shows C
    expect(selectedPicture(pic(A))?.asset).toBe(C);
    const r2 = await stepTake('next', { canvas: CANVAS, selected: pic(A), fetch: f });
    expect(r2.ok && r2.asset).toBe(A);
  });

  test('an op-log write is not recorded twice; a refusal is said, nothing recorded', async () => {
    primeTakes(CANVAS, [A, B], null);
    const records: unknown[] = [];
    const opLog = fakeFetch(() => ({ body: { ok: true, writeId: 'w2', actionId: 'act_1' } }));
    await stepTake('next', {
      canvas: CANVAS,
      selected: pic(A),
      fetch: opLog,
      record: (p: unknown) => records.push(p),
    });
    expect(records).toEqual([]);
    resetTakes();
    primeTakes(CANVAS, [A, B], null);
    const locked = fakeFetch(() => ({ status: 409, body: { ok: false, code: 'locked' } }));
    const r = await stepTake('next', {
      canvas: CANVAS,
      selected: pic(A),
      fetch: locked,
      record: (p: unknown) => records.push(p),
    });
    expect(r).toEqual({ ok: false, message: 'Not changed. That is locked; unlock it first.' });
    expect(records).toEqual([]);
  });

  test('a picture with one take, or none, never steps', async () => {
    primeTakes(CANVAS, [A], null);
    const calls: Call[] = [];
    const f = fakeFetch(() => ({ body: { ok: true } }), calls);
    expect((await stepTake('next', { canvas: CANVAS, selected: pic(A), fetch: f })).ok).toBe(false);
    expect(calls.length).toBe(0);
  });

  test('take-step is honoured only from the focused active canvas, on its origin', () => {
    const active = {} as Window;
    const other = {} as Window;
    const ev = (
      source: Window,
      origin = 'http://canvas.test',
      data: unknown = { dgn: 'take-step', dir: 'next' }
    ) => ({ data, source, origin }) as unknown as MessageEvent;
    const o = (focused: boolean) => ({
      canvasOrigin: 'http://canvas.test',
      active,
      focused: () => focused,
    });
    expect(acceptTakeStep(ev(active), o(true))).toBe('next');
    expect(acceptTakeStep(ev(other), o(true))).toBeNull();
    expect(acceptTakeStep(ev(active, 'http://evil.test'), o(true))).toBeNull();
    expect(acceptTakeStep(ev(active), o(false))).toBeNull();
    expect(
      acceptTakeStep(ev(active, undefined, { dgn: 'take-step', dir: 'up' }), o(true))
    ).toBeNull();
  });
});

describe('the ask — client/v2/assets/generate-ask.jsx', () => {
  const target = { canvas: CANVAS, artboardId: 'post' };
  const quote = {
    ok: true,
    quote: 'q_1',
    provider: 'stub',
    model: 'stub-solid',
    n: 4,
    aspect: '4:5',
    lines: { time: 'About 30 s · nothing is billed', licence: 'Test pictures, free to use.' },
  };

  test('the quote is asked for the selected artboard; no artboard, no ask', async () => {
    const calls: Call[] = [];
    const f = fakeFetch(() => ({ body: quote }), calls);
    expect((await askQuote(null, { n: 4 }, { fetch: f })).ok).toBe(false);
    expect(calls.length).toBe(0);
    const r = await askQuote(target, { n: 4 }, { fetch: f });
    expect(r.ok).toBe(true);
    expect(calls[0]?.url).toBe('/_api/generate-takes/quote');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      canvas: CANVAS,
      artboard: 'post',
      n: 4,
    });
    const none = fakeFetch(() => ({ status: 409, body: { ok: false, reason: 'no-provider' } }));
    expect(await askQuote(target, { n: 4 }, { fetch: none })).toEqual({
      ok: false,
      message: 'No image provider is ready. Add a key in Settings › Connections.',
    });
  });

  test('a run hands the quote back, waits, places the best (auto) and selects it', async () => {
    const calls: Call[] = [];
    let polls = 0;
    const f = fakeFetch((url) => {
      if (url === '/_api/generate-takes')
        return { status: 202, body: { ok: true, group: 'g_0123456789ab', jobIds: [] } };
      if (url.startsWith('/_api/generate-takes?')) {
        polls += 1;
        return polls < 2
          ? { body: { ok: true, status: 'running' } }
          : {
              body: {
                ok: true,
                status: 'done',
                takes: [B, C, A],
                best: C,
                provider: 'stub',
                model: 'stub-solid',
              },
            };
      }
      if (url === '/_api/edit-op')
        return {
          body: { ok: true, writeId: 'w9', created: [{ artboard: 'post', element: 'img-1' }] },
        };
      return { status: 404, body: {} };
    }, calls);
    const selected: unknown[] = [];
    const records: unknown[] = [];
    const r = await runGenerate(
      { target, quote, prompt: 'a touchdown', where: 'Gameweek 5' },
      {
        fetch: f,
        sleep: async () => {},
        select: (c: unknown) => selected.push(c),
        record: (p: unknown) => records.push(p),
      }
    );
    expect(r).toMatchObject({
      ok: true,
      best: C,
      line: 'Placed take 2 in Gameweek 5. The other two are in Assets › Generated.',
    });
    const start = JSON.parse(String(calls[0]?.init?.body));
    expect(start).toMatchObject({
      quote: 'q_1',
      canvas: CANVAS,
      artboard: 'post',
      prompt: 'a touchdown',
      n: 4,
      aspect: '4:5',
    });
    const place = calls.find((c) => c.url === '/_api/edit-op');
    expect(JSON.parse(String(place?.init?.body))).toMatchObject({
      file: CANVAS,
      op: 'image.place',
      params: { asset: C, mode: 'auto', artboard: 'post' },
    });
    expect(selected).toEqual([{ artboard: 'post', element: 'img-1' }]);
    expect(records).toEqual([{ op: 'edit-op', writeId: 'w9', label: 'Place picture' }]);
    // ← → work at once: every take is held
    expect(takeAssetsOf(CANVAS)).toEqual([A, B, C]);
  });

  test('no consent → nothing placed, a fresh quote is asked for', async () => {
    const calls: Call[] = [];
    const f = fakeFetch(() => ({ status: 409, body: { ok: false, reason: 'no-consent' } }), calls);
    const r = await runGenerate(
      { target, quote, prompt: 'x', where: null },
      { fetch: f, sleep: async () => {} }
    );
    expect(r).toMatchObject({ ok: false, requote: true });
    expect(calls.map((c) => c.url)).toEqual(['/_api/generate-takes']);
  });

  test('the toast words', () => {
    expect(placedLine(2, 4, 'Gameweek 5')).toBe(
      'Placed take 3 in Gameweek 5. The other three are in Assets › Generated.'
    );
    expect(placedLine(0, 2, null)).toBe('Placed take 1. The other one is in Assets › Generated.');
    expect(placedLine(0, 1, 'Gameweek 5')).toBe('Placed the picture in Gameweek 5.');
  });
});
