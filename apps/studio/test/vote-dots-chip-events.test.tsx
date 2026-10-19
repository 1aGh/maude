// S4.V4 G3 (wave-A gate fix 3c) — pressing "+" on an artboard's vote chip moved no pending pick: the
// chips render in the annotation layer's world portal, inside `.dc-world`, where the input router claims a
// bare Move click in its capture phase (preventDefault + stopImmediatePropagation, never yielding to a class
// name there — issue-90) and Preview's Hand pans from a pointerdown off the design (pointer capture
// retargets the click). The chip's React onClick never ran, so no `vote-cast` reached the shell.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { VoteDots } from '../annotations/ui/vote-dots.tsx';
import { type Tool, useInputRouter } from '../input-router.tsx';

function Canvas({ tool, onSelect }: { tool: Tool; onSelect: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  useInputRouter({ hostRef, getActiveTool: () => tool, callbacks: { onSelect } });
  return (
    <div ref={hostRef} className="dc-canvas">
      <div className="dc-world">
        <VoteDots zoom={1} />
      </div>
    </div>
  );
}

function press(el: Element): void {
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
}

async function mount(tool: Tool) {
  (window as unknown as { __maudeCanvasRects: () => unknown }).__maudeCanvasRects = () => ({
    artboards: [
      { id: 'home', x: 0, y: 0, w: 100, h: 100 },
      { id: 'pricing', x: 200, y: 0, w: 100, h: 100 },
    ],
  });
  const posted: Array<Record<string, unknown>> = [];
  const parent = window.parent as Window;
  const realPost = parent.postMessage.bind(parent);
  parent.postMessage = ((m: Record<string, unknown>) => {
    posted.push(m);
  }) as typeof parent.postMessage;
  let selects = 0;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Canvas tool={tool} onSelect={() => (selects += 1)} />));
  const ev = new Event('message');
  Object.defineProperties(ev, {
    data: {
      value: {
        dgn: 'vote-state',
        vote: { id: 'v_1', targets: ['ab:home', 'ab:pricing'], state: 'open', perVoter: 3 },
        mine: { 'ab:home': 1 },
      },
    },
    source: { value: parent },
    origin: { value: window.location.origin },
  });
  await act(async () => {
    window.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 5));
  });
  return {
    host,
    posted,
    selects: () => selects,
    done: () => {
      act(() => root.unmount());
      host.remove();
      parent.postMessage = realPost as typeof parent.postMessage;
    },
  };
}

const casts = (posted: Array<Record<string, unknown>>) =>
  posted.filter((m) => m.dgn === 'vote-cast');

describe('S4.V4 G3 — a vote chip hears its own click over the canvas router', () => {
  for (const tool of ['move', 'browse'] as Tool[]) {
    test(`${tool}: "+" posts vote-cast; the router selects nothing`, async () => {
      const r = await mount(tool);
      const add = r.host.querySelector('[data-testid="vote-add-pricing"]');
      expect(add).not.toBeNull();
      await act(async () => press(add as Element));
      expect(casts(r.posted)).toEqual([{ dgn: 'vote-cast', artboard: 'pricing' }]);
      expect(r.selects()).toBe(0);
      r.done();
    });
  }

  test('a dot takes the vote back (remove)', async () => {
    const r = await mount('move');
    const dot = r.host.querySelector('[data-testid="vote-dots-home"] .dc-vdot');
    expect(dot).not.toBeNull();
    await act(async () => press(dot as Element));
    expect(casts(r.posted)).toEqual([{ dgn: 'vote-cast', artboard: 'home', remove: true }]);
    r.done();
  });

  test('a canvas element copying the chip markup outside the chip layer casts nothing', async () => {
    const r = await mount('move');
    const fake = document.createElement('div');
    fake.className = 'dc-annot-votes';
    fake.innerHTML = '<button type="button" data-vote-act="add" data-vote-ab="pricing">+</button>';
    r.host.querySelector('.dc-world')?.append(fake);
    await act(async () => press(fake.querySelector('button') as Element));
    expect(casts(r.posted)).toEqual([]);
    r.done();
  });
});

// The bar's bold runs rendered 400: `--w-semibold` lives under `.maude-v2[data-theme]`, which the shell root
// does not carry. The bar and the sheet take the scope on their own roots (v2-scope.js).
describe('S4.V4 — the vote bar takes the v2 token scope', () => {
  test('VoteBar root carries .maude-v2 and a theme', async () => {
    const { VoteBar } = await import('../client/v2/annotations/vote-bar.jsx');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const now = Date.UTC(2026, 9, 1, 10, 0, 0);
    const state = {
      vote: {
        id: 'v',
        targets: ['ab:a'],
        perVoter: 3,
        state: 'open',
        endsAt: now + 60_000,
        done: [],
      },
      mine: {},
      pending: null,
      canEdit: false,
    };
    await act(async () => root.render(<VoteBar state={state} now={now} />));
    const bar = host.querySelector('[data-testid="vote-bar"]');
    expect(bar?.classList.contains('maude-v2')).toBe(true);
    expect(bar?.getAttribute('data-theme')).toMatch(/^(light|dark)$/);
    act(() => root.unmount());
    host.remove();
  });
});
