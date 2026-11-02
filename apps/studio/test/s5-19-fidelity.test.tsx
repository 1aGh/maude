// S5.19 (03 AI Chat, S5.V3 verdicts G3 / G4 / nit): the point ring of a question, the day dividers of a long
// chat, Before / After + Compare in the Result card, and no follow-up chips after a failed run.
// Red first: none of dayDividerFor, pointsFor / pointExpiry, AiPointRings, run-compare.js, the `thumbs` of the
// Result card, `lastFailed` or the transcript's `at` existed.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

let registeredHere = false;
beforeAll(async () => {
  if (typeof document === 'undefined') {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    GlobalRegistrator.register();
    registeredHere = true;
  }
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const tmp: string[] = [];
afterAll(async () => {
  for (const d of tmp) rmSync(d, { recursive: true, force: true });
  if (registeredHere && GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { readChatMessages } from '../acp/transcript.ts';
import { ResultCard } from '../client/v2/ai/Result.jsx';
import { beforeAfterOf, compareView, fetchRunVersions } from '../client/v2/ai/run-compare.js';
import { dayDividerFor, resultVerbs } from '../client/v2/ai/run-model.js';
import { POINT_MS, pointExpiry, pointsFor } from '../client/v2/ai/runs-model.js';
import { deriveSuggestions } from '../client/v2/ai/suggest-why.js';
import { AiPointRings } from '../editing/ai-point-ring.tsx';

// ── day dividers ──────────────────────────────────────────────────────────────────────────────────
describe('dayDividerFor — "Yesterday, 18:20" / "Today, 09:12" (03 ai-long)', () => {
  const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m).getTime();
  const now = at(19, 12, 0);
  const stamps = [
    ['a', at(18, 18, 20)],
    ['b', at(18, 18, 40)],
    ['c', at(19, 9, 12)],
    ['d', at(19, 9, 30)],
  ];
  test('the first ask of a new day gets the divider; later asks of that day do not', () => {
    expect(dayDividerFor(stamps, 'a', now)).toBe('Yesterday, 18:20');
    expect(dayDividerFor(stamps, 'b', now)).toBeNull();
    expect(dayDividerFor(stamps, 'c', now)).toBe('Today, 09:12');
    expect(dayDividerFor(stamps, 'd', now)).toBeNull();
  });
  test('a fresh chat has no "Today" above its first ask; an older first ask is dated (absolute, 24-hour)', () => {
    expect(dayDividerFor([['x', at(19, 8, 5)]], 'x', now)).toBeNull();
    expect(dayDividerFor([['x', at(6, 14, 5)]], 'x', now)).toBe('6 Oct, 14:05');
  });
  test('an ask with no time known gets none', () => {
    expect(dayDividerFor([['x', null]], 'x', now)).toBeNull();
    expect(dayDividerFor(stamps, 'zzz', now)).toBeNull();
  });
});

describe('the transcript carries when an ask was sent', () => {
  test('a user turn has `at` from its line’s ts; an assistant turn has none', () => {
    const root = mkdtempSync(path.join(tmpdir(), 's519-tr-'));
    tmp.push(root);
    mkdirSync(path.join(root, '_chat'), { recursive: true });
    writeFileSync(
      path.join(root, '_chat', 'c1.jsonl'),
      [
        JSON.stringify({ ts: 1760000000000, role: 'user', text: 'hello' }),
        JSON.stringify({
          ts: 1760000001000,
          role: 'agent',
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hi' } },
        }),
      ].join('\n')
    );
    const msgs = readChatMessages(root, 'c1');
    expect(msgs[0].at).toBe(1760000000000);
    expect(msgs[1].at).toBeUndefined();
  });
});

// ── Before / After + Compare ──────────────────────────────────────────────────────────────────────
describe('Before / After + Compare in the Result card (03 ai-long)', () => {
  const row = (rev: number, runId: string | undefined, pic: string | null, extra = {}) => ({
    rev,
    runId,
    ref: `r${rev}`,
    picture: pic ? { status: 'ready', url: pic } : { status: 'pending' },
    ...extra,
  });
  const rows = [
    row(5, 'run-2', '/p/5.png'),
    row(4, undefined, '/p/4.png', { undoes: ['x'] }),
    row(3, 'run-1', '/p/3.png'),
    row(2, undefined, '/p/2.png'),
  ];
  test('After = the run’s own version; Before = the next older one that is not an undo', () => {
    const r = beforeAfterOf(rows, 'run-1');
    expect(r.after?.rev).toBe(3);
    expect(r.before?.rev).toBe(2);
    expect(beforeAfterOf(rows, 'run-2').before?.rev).toBe(3); // the undo row (4) is skipped
    expect(beforeAfterOf(rows, 'nope')).toEqual({ after: null, before: null });
  });
  test('thumbs only when BOTH pictures are drawn; Compare as soon as there is a Before version', () => {
    expect(compareView(beforeAfterOf(rows, 'run-1'))).toMatchObject({
      canCompare: true,
      thumbs: { before: '/p/2.png', after: '/p/3.png' },
    });
    const pending = compareView({
      after: row(3, 'r', '/p/3.png'),
      before: row(2, undefined, null),
    });
    expect(pending.canCompare).toBe(true);
    expect(pending.thumbs).toBeNull();
    expect(pending.pending).toBe(true);
    // the canvas’s first version: nothing older, no Compare
    expect(compareView({ after: row(1, 'r', '/p/1.png'), before: null }).canCompare).toBe(false);
  });
  test('the verbs: Undo · Compare when it can compare, Undo · Keep going otherwise', () => {
    const run = {
      state: 'ended',
      outcome: 'done',
      touched: { 'ui/a.tsx': ['post'] },
    };
    expect(resultVerbs(run, { canCompare: true })).toEqual(['Undo', 'Compare']);
    expect(resultVerbs(run, { canCompare: false })).toEqual(['Undo', 'Keep going']);
  });
  test('fetchRunVersions reads the canvas’s versions and finds the run', async () => {
    const urls: string[] = [];
    const out = await fetchRunVersions(
      { runId: 'run-1', scope: { canvas: 'ui/C.tsx' } },
      {
        designRel: '.design',
        fetchImpl: (async (u: string) => {
          urls.push(u);
          return { json: async () => ({ ok: true, rows }) };
        }) as never,
      }
    );
    expect(urls[0]).toContain('path=.design%2Fui%2FC.tsx');
    expect(out?.before?.rev).toBe(2);
    expect(out?.path).toBe('.design/ui/C.tsx');
    expect(await fetchRunVersions({ runId: 'r' }, {})).toBeNull();
  });
  test('the card draws Before → After when it has thumbs, nothing when it has none', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById('root') as HTMLElement);
    await act(async () => {
      root.render(
        <ResultCard
          verbs={['Undo', 'Compare']}
          onVerb={() => {}}
          thumbs={{ before: '/p/2.png', after: '/p/3.png' }}
        />
      );
    });
    const ba = document.querySelector('[data-testid="ai-result-before-after"]');
    expect(ba?.textContent).toContain('Before');
    expect(ba?.textContent).toContain('After');
    expect(ba?.querySelectorAll('img').length).toBe(2);
    await act(async () => {
      root.render(<ResultCard verbs={['Undo', 'Compare']} onVerb={() => {}} thumbs={null} />);
    });
    expect(document.querySelector('[data-testid="ai-result-before-after"]')).toBeNull();
    expect(document.querySelector('[data-testid="ai-result-compare"]')).not.toBeNull();
    await act(async () => {
      root.unmount();
    });
  });
});

// ── nit: no follow-up chips after a failed run ─────────────────────────────────────────────────────
describe('suggestions after a failed run', () => {
  test('"Try a variation / Explain what changed" follow an ask that worked, not one that failed', () => {
    const ok = deriveSuggestions({ lastAsk: { text: 'Make the poster calmer' } });
    expect(ok?.chips.map((c) => c.label)).toContain('Explain what changed');
    expect(
      deriveSuggestions({ lastAsk: { text: 'Make the poster calmer' }, lastFailed: true })
    ).toBeNull();
  });
});

// ── G3: the point ring ──────────────────────────────────────────────────────────────────────────────
describe('pointsFor — the spot an answered question points at', () => {
  const now = 1_000_000;
  const key = { canvas: 'path:.design/ui/C.tsx', artboard: 'poster' };
  const question = (extra = {}) => ({
    runId: 'q1',
    state: 'ended',
    outcome: 'done',
    endedAt: now - 2000,
    touched: {},
    label: 'Is the date line readable from three metres? (secret prompt)',
    scope: {
      canvas: 'ui/C.tsx',
      artboards: ['poster'],
      elements: [{ ...key, element: 'date-line' }],
    },
    ...extra,
  });
  const at = (view: unknown) => pointsFor(view, { activeCanvas: '.design/ui/C.tsx', now });

  test('a question that changed nothing marks the element it was about — by NAME only', () => {
    const rows = at({ mine: [question()] });
    expect(rows).toEqual([
      { artboard: 'poster', element: 'date-line', tag: 'Date line', mine: true, point: true },
    ]);
    // never a word of the prompt (DDR-054; v2-lead-neutral-ai-ring-tags)
    expect(JSON.stringify(rows)).not.toContain('secret');
    expect(JSON.stringify(rows)).not.toContain('readable');
  });
  test('not when the run changed something, failed, is still running, is old, or is on another canvas', () => {
    expect(at({ mine: [question({ touched: { 'ui/C.tsx': ['poster'] } })] })).toEqual([]);
    expect(at({ mine: [question({ outcome: 'failed' })] })).toEqual([]);
    expect(at({ mine: [question({ state: 'running' })] })).toEqual([]);
    expect(at({ mine: [question({ endedAt: now - POINT_MS - 1 })] })).toEqual([]);
    expect(
      pointsFor({ mine: [question()] }, { activeCanvas: '.design/ui/Other.tsx', now })
    ).toEqual([]);
  });
  test('the newest question wins; the relay is told when it lets go', () => {
    const older = question({ runId: 'q0', endedAt: now - 9000 });
    const newer = question({
      endedAt: now - 1000,
      scope: { canvas: 'ui/C.tsx', artboards: ['poster'], elements: [{ ...key, element: 'logo' }] },
    });
    expect(at({ mine: [older, newer] }).map((r: { element: string }) => r.element)).toEqual([
      'logo',
    ]);
    expect(pointExpiry({ mine: [older, newer] }, now)).toBe(now - 1000 + POINT_MS);
    expect(pointExpiry({ mine: [] }, now)).toBeNull();
  });
});

describe('AiPointRings — the small spark ring on the canvas', () => {
  const parent = { postMessage: () => {} };
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
  const box = (left: number, top: number, w: number, h: number) =>
    ({ left, top, right: left + w, bottom: top + h, width: w, height: h }) as DOMRect;

  beforeEach(() => {
    Object.defineProperty(window, 'parent', { value: parent, configurable: true });
    document.body.innerHTML = `<div id="root"></div><div data-dc-screen="poster">
      <div data-cd-id="date-line"></div><div data-cd-id="logo"></div></div>`;
    const rects: Record<string, DOMRect> = {
      'date-line': box(800, 647, 124, 20),
      logo: box(10, 10, 50, 50),
    };
    for (const el of document.querySelectorAll('[data-cd-id]'))
      (el as HTMLElement).getBoundingClientRect = () => rects[el.getAttribute('data-cd-id') ?? ''];
  });
  const say = (holds: unknown[]) => {
    const ev = new MessageEvent('message', { data: { dgn: 'ai-holds', holds } });
    Object.defineProperty(ev, 'source', { value: parent });
    window.dispatchEvent(ev);
  };

  test('a point row draws a ring on its element with its name; a click puts it away; a new spot brings it back', async () => {
    const root = createRoot(document.getElementById('root') as HTMLElement);
    await act(async () => {
      root.render(<AiPointRings />);
    });
    expect(document.querySelector('[data-testid="edit-ai-point"]')).toBeNull();
    const pt = {
      artboard: 'poster',
      element: 'date-line',
      tag: 'Date line',
      mine: true,
      point: true,
    };
    const held = { artboard: 'poster', element: 'logo', tag: 'AI is working', mine: true };
    await act(async () => {
      say([held, pt]);
    });
    await act(async () => {
      await frame();
      await frame();
    });
    const rings = document.querySelectorAll('[data-testid="edit-ai-point"]');
    expect(rings.length).toBe(1); // the ordinary hold row is not a point
    const ring = rings[0] as HTMLElement;
    expect(ring.textContent).toBe('Date line');
    expect(ring.style.left).toBe('797px');
    expect(ring.style.top).toBe('644px');
    expect(ring.style.width).toBe('130px');
    // gone when you click
    await act(async () => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    expect(document.querySelector('[data-testid="edit-ai-point"]')).toBeNull();
    // the same spot re-sent stays away; a different one is news
    await act(async () => {
      say([pt]);
    });
    expect(document.querySelector('[data-testid="edit-ai-point"]')).toBeNull();
    await act(async () => {
      say([{ ...pt, element: 'logo', tag: 'Logo' }]);
    });
    await act(async () => {
      await frame();
    });
    expect(document.querySelector('[data-testid="edit-ai-point"]')?.textContent).toBe('Logo');
    await act(async () => {
      root.unmount();
    });
  });
});
