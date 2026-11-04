// 2.0.4 task B + #189 — the load-failure slot's four variants (client/v2/code/canvas-error-card.jsx
// `CanvasLoadFailure` → canvas-waiting-card.jsx):
//
//   waiting        "Uniformy-2027 is still downloading." · 3 of 5 files · Project sync · the names
//                  (five, then "and N more") · no Ask AI · loads by itself when the files land
//   refused        "Uniformy-2027 can't open on this Mac yet." · the code-consent sentence pointing at
//                  Settings › Connections · no Ask AI
//   build failure  "… can't be drawn right now." · the app's side, not the code · the reason class
//                  under Show details · no Ask AI · never "No details were reported" (#189)
//   code error     unchanged: "Its code has a mistake the canvas can't show." + Ask AI to fix it
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const CANVAS = 'ui/Uniformy-2027.tsx';
const ERROR = {
  kind: 'syntax',
  message: 'Expected "}" but found ")"',
  file: 'ui/Uniformy-2027.tsx',
  line: 3,
  column: 2,
  lineText: '  x)',
};
const WAITING = {
  files: [
    { rel: 'ui/a1.ts', state: 'downloading' },
    { rel: 'ui/a2.ts', state: 'downloading' },
    { rel: 'ui/a3.css', state: 'waiting', reason: 'not-shared' },
    { rel: 'ui/a4.ts', state: 'waiting', reason: 'retrying' },
    { rel: 'ui/a5.ts', state: 'downloading' },
    { rel: 'ui/a6.ts', state: 'downloading' },
    { rel: 'ui/a7.ts', state: 'downloading' },
  ],
  more: 1,
  need: { here: 3, total: 11 },
  progress: { delivered: 5029, total: 5041 },
};
const REFUSED = {
  files: [{ rel: 'ui/_uniform-template.ts', state: 'refused', reason: 'code-consent' }],
  more: 0,
  need: { here: 4, total: 5 },
  progress: { delivered: 5029, total: 5041 },
};

describe('the load-failure slot', () => {
  const roots: Root[] = [];
  let CanvasLoadFailure: typeof import('../client/v2/code/canvas-error-card.jsx').CanvasLoadFailure;
  let INDEX_CHANGED_EVENT: string;

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    ({ CanvasLoadFailure } = await import('../client/v2/code/canvas-error-card.jsx'));
    ({ INDEX_CHANGED_EVENT } = await import('../client/v2/canvases/use-canvas-index.js'));
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
  });

  const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  async function mount(el: React.ReactElement) {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(el);
    });
    await settle();
    return host;
  }
  /** `/_api/canvas-errors` answers `answers[n]` on the n-th ask (the last one repeats). */
  const errorsRoute = (answers: unknown[], seen: { n: number } = { n: 0 }) =>
    (async (url: string) => {
      if (!url.startsWith('/_api/canvas-errors')) return new Response('{}', { status: 404 });
      const body = answers[Math.min(seen.n, answers.length - 1)];
      seen.n += 1;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

  test('waiting: still downloading, a bar of the files it needs, the project’s sync, five names and N more', async () => {
    await mount(
      <CanvasLoadFailure
        canvas={CANVAS}
        askAiAvailable
        onAskAi={() => {}}
        fetchImpl={errorsRoute([{ canvas: CANVAS, errors: [], waiting: WAITING }])}
      />
    );
    expect(q('canvas-waiting-card')?.dataset.kind).toBe('waiting');
    expect(q('canvas-waiting-title')?.textContent).toBe('Uniformy-2027 is still downloading.');
    expect(q('canvas-waiting-body')?.textContent).toBe(
      "Some of its files haven't reached this Mac yet. Nothing is lost. The canvas opens by itself when they arrive."
    );
    expect(q('canvas-waiting-progress')?.textContent).toContain('3 of 11 files');
    const bar = q('canvas-waiting-progress')?.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('3');
    expect(bar?.getAttribute('aria-valuemax')).toBe('11');
    expect(q('canvas-waiting-project')?.textContent).toBe('Project sync: 5,029 of 5,041 files');
    const names = [...(q('canvas-waiting-files')?.querySelectorAll('.v2-err-file-n') ?? [])].map(
      (n) => n.textContent
    );
    expect(names).toEqual(['a1.ts', 'a2.ts', 'a3.css', 'a4.ts', 'a5.ts']);
    expect(q('canvas-waiting-files')?.textContent).toContain('not shared yet');
    expect(q('canvas-waiting-files')?.textContent).toContain('retrying');
    // 7 listed − 5 shown + 1 the server left out
    expect(q('canvas-waiting-more')?.textContent).toBe('and 3 more');
    // not a mistake in the code: no error card, no Ask AI
    expect(q('canvas-error-card')).toBeNull();
    expect(q('canvas-error-ask-ai')).toBeNull();
    expect(document.body.textContent).not.toContain("can't be drawn");
  });

  test('refused: the code-consent sentence with Settings › Connections, no Ask AI', async () => {
    await mount(
      <CanvasLoadFailure
        canvas={CANVAS}
        askAiAvailable
        onAskAi={() => {}}
        fetchImpl={errorsRoute([{ canvas: CANVAS, errors: [], waiting: REFUSED }])}
      />
    );
    expect(q('canvas-waiting-card')?.dataset.kind).toBe('refused');
    expect(q('canvas-waiting-title')?.textContent).toBe(
      "Uniformy-2027 can't open on this Mac yet."
    );
    expect(q('canvas-waiting-body')?.textContent).toBe(
      "This Mac hasn't accepted shared code from this project (_uniform-template.ts). Nothing is lost. To allow it, open Settings › Connections."
    );
    expect(q('canvas-waiting-progress')).toBeNull();
    expect(q('canvas-error-ask-ai')).toBeNull();
    expect(document.body.textContent).not.toContain('Ask AI');
  });

  test('the server’s words only: an unknown state or reason is dropped, never drawn', async () => {
    await mount(
      <CanvasLoadFailure
        canvas={CANVAS}
        fetchImpl={errorsRoute([
          {
            canvas: CANVAS,
            errors: [],
            waiting: {
              files: [
                { rel: 'ui/x.ts', state: 'downloading', reason: 'HUB: click evil.example' },
                { rel: 'ui/y.ts', state: 'pwned' },
              ],
              need: { here: 1, total: 3 },
            },
          },
        ])}
      />
    );
    expect(document.body.textContent).not.toContain('evil.example');
    expect(document.body.textContent).not.toContain('y.ts');
    expect(q('canvas-waiting-title')?.textContent).toBe('Uniformy-2027 is still downloading.');
  });

  test('when the files land the canvas loads by itself (a landed file re-asks at once)', async () => {
    const seen = { n: 0 };
    let reloads = 0;
    await mount(
      <CanvasLoadFailure
        canvas={CANVAS}
        watchMs={60_000}
        onReload={() => {
          reloads += 1;
        }}
        fetchImpl={errorsRoute(
          [
            { canvas: CANVAS, errors: [], waiting: WAITING },
            { canvas: CANVAS, errors: [], waiting: { ...WAITING, need: { here: 9, total: 11 } } },
            { canvas: CANVAS, errors: [] },
          ],
          seen
        )}
      />
    );
    expect(q('canvas-waiting-progress')?.textContent).toContain('3 of 11 files');
    expect(reloads).toBe(0);
    // a file landed: the index moved — the card re-asks without a "Checking…" flash
    await act(async () => {
      window.dispatchEvent(new window.CustomEvent(INDEX_CHANGED_EVENT));
    });
    await settle();
    expect(q('canvas-error-wait')).toBeNull();
    expect(q('canvas-waiting-progress')?.textContent).toContain('9 of 11 files');
    expect(reloads).toBe(0);
    // the rest landed: nothing is missing any more, so the canvas reloads by itself, once
    await act(async () => {
      window.dispatchEvent(new window.CustomEvent(INDEX_CHANGED_EVENT));
    });
    await settle();
    expect(reloads).toBe(1);
    expect(seen.n).toBe(3);
  });

  test('…and on a modest timer when no index event comes', async () => {
    let reloads = 0;
    await mount(
      <CanvasLoadFailure
        canvas={CANVAS}
        watchMs={20}
        onReload={() => {
          reloads += 1;
        }}
        fetchImpl={errorsRoute([
          { canvas: CANVAS, errors: [], waiting: WAITING },
          { canvas: CANVAS, errors: [] },
        ])}
      />
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    await settle();
    expect(reloads).toBe(1);
  });

  test('#189 build failure: the app’s side, not the code; the reason under Show details; no Ask AI', async () => {
    await mount(
      <CanvasLoadFailure
        canvas={CANVAS}
        askAiAvailable
        onAskAi={() => {}}
        fetchImpl={errorsRoute([{ canvas: CANVAS, errors: [], buildFailure: { class: 'engine' } }])}
      />
    );
    expect(q('canvas-error-title')?.textContent).toBe("Uniformy-2027 can't be drawn right now.");
    expect(q('canvas-error-body')?.textContent).toBe(
      "It couldn't be built, and the cause is on the app's side, not in its code. Nothing is lost."
    );
    expect(q('canvas-error-ask-ai')).toBeNull();
    await act(async () => {
      q('fold-canvas-error-toggle')?.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true })
      );
    });
    expect(q('canvas-error-build-reason')?.textContent).toBe('The build engine is unavailable');
    expect(q('canvas-error-none')).toBeNull();
    expect(document.body.textContent).not.toContain('No details were reported');
  });

  test('#189 the other classes, in words', async () => {
    const { buildFailureReason } = await import('../client/v2/code/canvas-waiting.js');
    expect(buildFailureReason({ class: 'timed-out' })).toBe('The build timed out');
    expect(buildFailureReason({ class: 'memory' })).toBe('The build ran out of memory');
    expect(buildFailureReason({ class: 'imports-refused', count: 1 })).toBe('1 import refused');
    expect(buildFailureReason({ class: 'imports-refused', count: 3 })).toBe('3 imports refused');
  });

  test('a genuine code error keeps its card and Ask AI to fix it', async () => {
    await mount(
      <CanvasLoadFailure
        canvas={CANVAS}
        askAiAvailable
        onAskAi={() => {}}
        fetchImpl={errorsRoute([{ canvas: CANVAS, errors: [ERROR] }])}
      />
    );
    expect(q('canvas-waiting-card')).toBeNull();
    expect(q('canvas-error-body')?.textContent).toContain(
      "Its code has a mistake the canvas can't show."
    );
    expect(q('canvas-error-ask-ai')?.textContent).toContain('Ask AI to fix it');
  });
});
