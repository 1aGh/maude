// S7.15 — Other takes as a person meets it (07 · ve-ai-adjust): select a clip, ask for its other takes, see them
// with AI's pick marked, click one. Real markup and store; only fetch is faked (the footage route). The model
// and the op are pinned in other-takes.test.ts.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
const reqs: string[] = [];
let analysis: Record<string, unknown> = {};
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    reqs.push(u);
    if (u.startsWith('/_api/footage')) return Response.json(analysis);
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const SEQ = {
  stableId: 'name:Touchdown 2',
  mediaTag: 'Video',
  mediaSrc: 'assets/a2222222.mp4',
  duration: 75,
  mediaProps: { trimBefore: 90 },
};
const ANALYSIS = {
  version: 1,
  durationSec: 10,
  shots: [
    { start: 1, end: 3.5, quality: 0.5, usable: true },
    { start: 3, end: 5.5, quality: 0.9, usable: true },
    { start: 4.5, end: 7, quality: 0.6, usable: true },
  ],
};

let host: HTMLElement;
let root: Root;
beforeEach(async () => {
  document.body.innerHTML = '';
  reqs.length = 0;
  analysis = ANALYSIS;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const { forgetFootage } = await import('../client/v2/timeline/other-takes-store.js');
  forgetFootage();
});
afterEach(async () => {
  await act(async () => root.unmount());
  const { otherTakesUi } = await import('../client/v2/timeline/other-takes.jsx');
  otherTakesUi.reset();
});

async function mount(over: Record<string, unknown> = {}) {
  const { OtherTakesHost, otherTakesUi } = await import('../client/v2/timeline/other-takes.jsx');
  const runs: Array<Record<string, unknown>> = [];
  const props = {
    seq: SEQ,
    fps: 30,
    name: 'Touchdown 2',
    canEdit: true,
    url: '/.design/assets/a2222222.mp4',
    run: async (params: Record<string, unknown>) => {
      runs.push(params);
      return { ok: true };
    },
    ...over,
  };
  await act(async () => {
    root.render(h(OtherTakesHost, props as never));
  });
  return { runs, open: () => act(async () => otherTakesUi.open()), ui: otherTakesUi };
}

const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));

describe('Other takes', () => {
  test('closed until asked for; opening shows the clip’s takes, the one it is on and AI’s pick', async () => {
    const { open } = await mount();
    expect(document.querySelector('[data-testid="other-takes"]')).toBeNull();
    await open();
    await settle();
    expect(document.querySelector('[data-testid="other-takes-title"]')?.textContent).toBe(
      'Other takes · Touchdown 2'
    );
    const takes = [...document.querySelectorAll('[data-testid="other-takes-take"]')];
    expect(takes.map((t) => t.querySelector('.tl-take-t')?.textContent)).toEqual([
      '0:01–0:03.5',
      '0:03–0:05.5',
      '0:04.5–0:07',
    ]);
    expect(takes.map((t) => t.getAttribute('data-on'))).toEqual([null, 'true', null]);
    expect(takes[1]?.textContent).toContain('AI’s pick');
    expect(takes[0]?.textContent).toContain('2.5 s');
    expect(document.querySelector('[data-testid="other-takes-foot"]')?.textContent).toBe(
      'Click a take to swap it in. Same length, same beat.'
    );
    expect(reqs).toEqual(['/_api/footage?asset=assets%2Fa2222222.mp4']);
  });

  test('clicking a take is one ordinary clip write with the new in-point, then it closes', async () => {
    const { open, runs, ui } = await mount();
    await open();
    await settle();
    const third = document.querySelectorAll(
      '[data-testid="other-takes-take"]'
    )[2] as HTMLButtonElement;
    await act(async () => {
      third.click();
    });
    await settle();
    expect(runs).toEqual([{ srcStart: 4.5, sourceSeconds: 10 }]);
    expect(ui.get()).toBeNull();
    expect(document.querySelector('[data-testid="other-takes"]')).toBeNull();
  });

  test('the take the clip is on cannot be clicked (nothing to swap)', async () => {
    const { open } = await mount();
    await open();
    await settle();
    const on = document.querySelector(
      '[data-testid="other-takes-take"][data-on="true"]'
    ) as HTMLButtonElement;
    expect(on.disabled).toBe(true);
  });

  test('read-only: the takes are shown, none can be swapped, and the foot says who to ask', async () => {
    const { open, runs } = await mount({ canEdit: false });
    await open();
    await settle();
    const takes = [
      ...document.querySelectorAll('[data-testid="other-takes-take"]'),
    ] as HTMLButtonElement[];
    expect(takes.every((t) => t.disabled)).toBe(true);
    expect(document.querySelector('[data-testid="other-takes-foot"]')?.textContent).toBe(
      'Ask the owner to change this.'
    );
    await act(async () => takes[0]?.click());
    expect(runs).toEqual([]);
  });

  test('a failed swap keeps the pop open', async () => {
    const { open, ui } = await mount({ run: async () => ({ ok: false }) });
    await open();
    await settle();
    const first = document.querySelectorAll(
      '[data-testid="other-takes-take"]'
    )[0] as HTMLButtonElement;
    await act(async () => first.click());
    await settle();
    expect(ui.get()).not.toBeNull();
    expect(document.querySelector('[data-testid="other-takes"]')).not.toBeNull();
  });

  test('Esc closes it', async () => {
    const { open, ui } = await mount();
    await open();
    await settle();
    const pop = document.querySelector('[data-testid="other-takes"]') as HTMLElement;
    await act(async () => {
      pop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(ui.get()).toBeNull();
  });

  test('a clip AI has not watched has no takes: nothing is drawn and it closes', async () => {
    analysis = {};
    const { open, ui } = await mount();
    await open();
    await settle();
    expect(document.querySelector('[data-testid="other-takes"]')).toBeNull();
    expect(ui.get()).toBeNull();
  });

  test('a clip with only its own take has nothing to offer', async () => {
    analysis = { ...ANALYSIS, shots: [ANALYSIS.shots[1]] };
    const { open, ui } = await mount();
    await open();
    await settle();
    expect(document.querySelector('[data-testid="other-takes"]')).toBeNull();
    expect(ui.get()).toBeNull();
  });

  test('a still image or a title has no takes: asking closes it without a request', async () => {
    const { open, ui } = await mount({ seq: { ...SEQ, mediaTag: 'Img' } });
    await open();
    await settle();
    expect(ui.get()).toBeNull();
    expect(reqs).toEqual([]);
  });
});
