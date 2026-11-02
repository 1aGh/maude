// S11.7 + S6.12 — the broken-canvas card (06 `ad-edge-syntax`, 01 `cf-render-error`): ONE card, two kinds.
//
// Done when: "<Canvas> can't be drawn right now." + "Ask AI to fix it" up front for everyone; the error,
// "Pricing.tsx · line 212, column 19" (copy), lines 210–213 with a caret, Open in editor, Copy error and
// Last good version under Show details; `kind: 'render'` (S6's contract) works with Go back to 14:05;
// Ask AI PRE-FILLS and never sends; error text from the canvas is only ever text; the v1 server-down card
// and the `canvas-load-retry` hook are still there.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  askAiText,
  errorText,
  excerptOf,
  ghostBoxes,
  goBackToLastGood,
  normalizeError,
  whereLabel,
} from '../client/v2/code/use-canvas-source.js';

const ERROR = {
  kind: 'syntax',
  message: 'Expected "}" but found ")"',
  file: 'ui/Pricing.tsx',
  line: 212,
  column: 19,
  lineText: '    <i>{plan.price)</i>',
};
const SRC_LINES = Array.from({ length: 220 }, (_, i) => `// filler ${i + 1}`);
SRC_LINES[209] = '  <span className="pr-plan">';
SRC_LINES[210] = '    <b>{plan.name}</b>';
SRC_LINES[211] = '    <i>{plan.price)</i>';
SRC_LINES[212] = '  </span>';

// ── the pure half ───────────────────────────────────────────────────────────────────────────────
describe('error text, in words', () => {
  test('where: file · line, column (and just the file with no position)', () => {
    expect(whereLabel(ERROR)).toBe('Pricing.tsx · line 212, column 19');
    expect(whereLabel({ ...ERROR, column: 0 })).toBe('Pricing.tsx · line 212');
    expect(whereLabel({ ...ERROR, line: 0, column: 0 })).toBe('Pricing.tsx');
    expect(whereLabel(null)).toBe('');
  });

  test('Copy error = the message, then where', () => {
    expect(errorText(ERROR)).toBe('Expected "}" but found ")"\nPricing.tsx · line 212, column 19');
  });

  test('the excerpt: lines 210–213 for an error on 212, the bad one marked, a caret under the column', () => {
    const ex = excerptOf(ERROR, SRC_LINES);
    expect(ex?.rows.map((r) => r.n)).toEqual([210, 211, 212, 213]);
    expect(ex?.rows.find((r) => r.bad)?.n).toBe(212);
    expect(ex?.rows.find((r) => r.bad)?.caret).toBe(`${' '.repeat(18)}^`);
    expect(ex?.rows.filter((r) => r.caret !== null)).toHaveLength(1);
  });

  test('without the source (Can view) the one quoted line stands alone', () => {
    const ex = excerptOf(ERROR, null);
    expect(ex?.rows.map((r) => [r.n, r.text, r.bad])).toEqual([
      [212, '    <i>{plan.price)</i>', true],
    ]);
  });

  test('no position, no excerpt', () => {
    expect(excerptOf({ ...ERROR, line: 0, column: 0 }, SRC_LINES)).toBeNull();
    expect(excerptOf(null, SRC_LINES)).toBeNull();
  });

  test('a tab before the column stays a tab in the caret row', () => {
    const ex = excerptOf({ ...ERROR, line: 1, column: 3, lineText: '' }, ['\t\tx']);
    expect(ex?.rows[0].caret).toBe('\t\t^');
  });

  test('the server’s error is cleaned: strings clipped, numbers made sane, junk refused', () => {
    expect(
      normalizeError({ message: 'x'.repeat(5000), line: -4, column: 'a' })?.message.length
    ).toBe(600);
    expect(normalizeError({ message: 'x', line: 2.9, column: 1 })).toMatchObject({
      line: 2,
      column: 1,
    });
    expect(normalizeError({ line: 1 })).toBeNull();
    expect(normalizeError(null)).toBeNull();
  });

  test('Ask AI text names the canvas and quotes the error as a quotation', () => {
    const t = askAiText({ canvas: 'ui/Pricing.tsx', error: ERROR });
    expect(t).toContain("Pricing can't be drawn right now");
    expect(t).toContain('Pricing.tsx · line 212, column 19');
    expect(t).toContain('“Expected "}" but found ")"”');
    expect(askAiText({ canvas: 'ui/Pricing.tsx', error: null })).toBe(
      "Pricing can't be drawn right now. Fix it."
    );
  });
});

describe('Go back to the last good version (S1.13)', () => {
  test('POSTs @last-good for this canvas and reports the line the server gave', async () => {
    const seen: { url: string; body: unknown }[] = [];
    const fetchImpl = (async (url: string, init: { body: string }) => {
      seen.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, line: 'Went back to 14:05' }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const r = await goBackToLastGood('ui/Pricing.tsx', { fetchImpl });
    expect(seen).toEqual([
      { url: '/_api/project/restore', body: { path: 'ui/Pricing.tsx', at: '@last-good' } },
    ]);
    expect(r).toEqual({ ok: true, line: 'Went back to 14:05' });
  });

  test('no good version / refused / down: words, and the canvas is as it was', async () => {
    const mk = (status: number) =>
      (async () =>
        new Response(JSON.stringify({ ok: false }), { status })) as unknown as typeof fetch;
    expect((await goBackToLastGood('a.tsx', { fetchImpl: mk(409) })).line).toContain(
      'no earlier version'
    );
    expect((await goBackToLastGood('a.tsx', { fetchImpl: mk(403) })).ok).toBe(false);
    const down = (async () => {
      throw new Error('x');
    }) as unknown as typeof fetch;
    expect((await goBackToLastGood('a.tsx', { fetchImpl: down })).ok).toBe(false);
  });
});

// ── the component ───────────────────────────────────────────────────────────────────────────────
describe('<CanvasErrorCard>', () => {
  const roots: Root[] = [];
  let CanvasErrorCard: typeof import('../client/v2/code/canvas-error-card.jsx').CanvasErrorCard;
  let CanvasLoadFailure: typeof import('../client/v2/code/canvas-error-card.jsx').CanvasLoadFailure;
  let clockLabel: typeof import('../client/v2/code/canvas-error-card.jsx').clockLabel;
  let whenLabel: typeof import('../client/v2/code/canvas-error-card.jsx').whenLabel;
  let bus: typeof import('../client/v2/code/code-bus.js');

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    ({ CanvasErrorCard, CanvasLoadFailure, clockLabel, whenLabel } = await import(
      '../client/v2/code/canvas-error-card.jsx'
    ));
    bus = await import('../client/v2/code/code-bus.js');
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });
  beforeEach(() => bus.resetCodeBusForTest());
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
  });

  const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const click = (el: Element | null) => {
    if (!el) throw new Error('missing element');
    return act(async () => {
      el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
  };
  async function mount(el: React.ReactElement) {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(el);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    return host;
  }
  const open = () => click(q('fold-canvas-error-toggle'));

  test('syntax: one sentence, nothing lost, one way out — the technical part is folded away', async () => {
    await mount(
      <CanvasErrorCard canvas="ui/Pricing.tsx" kind="syntax" error={ERROR} onAskAi={() => {}} />
    );
    expect(q('canvas-error-title')?.textContent).toBe("Pricing can't be drawn right now.");
    // the technical part (the line) is under Show details, never in the sentence
    expect(q('canvas-error-body')?.textContent).toContain("mistake the canvas can't show");
    expect(q('canvas-error-body')?.textContent).not.toMatch(/line \d|halfway/);
    expect(q('canvas-error-body')?.textContent).toContain('Version history');
    expect(q('canvas-error-ask-ai')?.textContent).toContain('Ask AI to fix it');
    // closed: no error text, no path, no line
    expect(q('canvas-error-message')).toBeNull();
    expect(q('canvas-error-where')).toBeNull();
    expect(q('canvas-error-excerpt')).toBeNull();
  });

  test('syntax: Show details has the error, the place (copy), lines 210–213 with a caret, and the verbs', async () => {
    const copied: string[] = [];
    await mount(
      <CanvasErrorCard
        canvas="ui/Pricing.tsx"
        kind="syntax"
        error={ERROR}
        lines={SRC_LINES}
        onAskAi={() => {}}
        onOpenInEditor={() => {}}
        onGoBack={() => {}}
        onReload={() => {}}
        onCopy={async (t: string) => {
          copied.push(t);
          return true;
        }}
      />
    );
    await open();
    expect(q('canvas-error-message')?.textContent).toBe('Expected "}" but found ")"');
    expect(q('canvas-error-where')?.textContent).toBe('Pricing.tsx · line 212, column 19');
    const rows = [
      ...(q('canvas-error-excerpt') as HTMLElement).querySelectorAll('.v2-err-snip-row'),
    ];
    // 210, 211, 212 (bad), the caret row under it, 213
    expect(rows.map((r) => r.querySelector('.v2-err-snip-n')?.textContent)).toEqual([
      '210',
      '211',
      '212',
      '',
      '213',
    ]);
    expect(rows[2].classList.contains('is-bad')).toBe(true);
    expect(rows[3].classList.contains('is-caret')).toBe(true);
    expect(rows[3].textContent?.trim()).toBe('^');
    for (const id of ['canvas-error-open-editor', 'canvas-error-copy', 'canvas-error-last-good']) {
      expect(q(id), id).not.toBeNull();
    }
    // 06 ad-edge-syntax draws no Reload canvas under a mistake on record (it lives at Menu › Diagnostics, ⌘R)
    expect(q('canvas-load-retry')).toBeNull();
    await click(q('canvas-error-copy-where'));
    await click(q('canvas-error-copy'));
    expect(copied).toEqual([
      'Pricing.tsx · line 212, column 19',
      'Expected "}" but found ")"\nPricing.tsx · line 212, column 19',
    ]);
  });

  test('Open in editor is not drawn when there is no editor door (a browser tab)', async () => {
    await mount(<CanvasErrorCard canvas="ui/Pricing.tsx" kind="syntax" error={ERROR} />);
    await open();
    expect(q('canvas-error-open-editor')).toBeNull();
    expect(q('canvas-error-ask-ai')).toBeNull();
  });

  test('Ask AI pre-fills: it hands the text to onAskAi and does nothing else', async () => {
    const asked: string[] = [];
    let fetched = 0;
    const real = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetched++;
      return new Response('{}');
    }) as unknown as typeof fetch;
    try {
      await mount(
        <CanvasErrorCard
          canvas="ui/Pricing.tsx"
          kind="syntax"
          error={ERROR}
          onAskAi={(t: string) => asked.push(t)}
        />
      );
      await click(q('canvas-error-ask-ai'));
    } finally {
      globalThis.fetch = real;
    }
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("Pricing can't be drawn right now");
    expect(fetched).toBe(0);
  });

  test('render (S6’s contract): Go back to 14:05 is the way out; Last good version is named', async () => {
    const at = new Date(2026, 9, 6, 14, 5).getTime();
    const back: unknown[] = [];
    await mount(
      <CanvasErrorCard
        canvas="ui/Pricing.tsx"
        kind="render"
        error={{ ...ERROR, line: 0, column: 0, lineText: '' }}
        lastGood={{ at }}
        onAskAi={() => {}}
        onGoBack={(lg: unknown) => back.push(lg)}
      />
    );
    expect(clockLabel(at)).toBe('14:05');
    expect(whenLabel(at)).toBe('6 Oct, 14:05');
    expect(q('canvas-error-last-good-line')?.textContent).toBe('Last good version · 6 Oct, 14:05');
    expect(q('canvas-error-body')?.textContent).toContain('from 6 Oct, 14:05');
    expect(q('canvas-error-go-back')?.textContent).toBe('Go back to 14:05');
    expect(q('canvas-error-ask-ai')).not.toBeNull();
    await click(q('canvas-error-go-back'));
    expect(back).toEqual([{ at }]);
    // the secondary "Last good version" button is not drawn twice
    await open();
    expect(q('canvas-error-last-good')).toBeNull();
    // and a render error has no Reload button unless the caller gives one
    expect(q('canvas-load-retry')).toBeNull();
  });

  test('render without a good version: still one sentence, no Go back', async () => {
    await mount(
      <CanvasErrorCard canvas="ui/Pricing.tsx" kind="render" error={null} onAskAi={() => {}} />
    );
    expect(q('canvas-error-go-back')).toBeNull();
    expect(q('canvas-error-body')?.textContent).toContain('Nothing is lost');
    await open();
    expect(q('canvas-error-none')).not.toBeNull();
  });

  test('error text from the canvas is text: no markup, no handlers', async () => {
    const evil = {
      ...ERROR,
      message: '<img src=x onerror="window.__pwned=1"><b onmouseover="x()">bold</b>',
      lineText: '<script>boom()</script>',
    };
    await mount(<CanvasErrorCard canvas="ui/Pricing.tsx" kind="syntax" error={evil} />);
    await open();
    const card = q('canvas-error-card') as HTMLElement;
    expect(card.querySelector('img, b, script')).toBeNull();
    expect(q('canvas-error-message')?.textContent).toContain('<img src=x');
    expect(q('canvas-error-excerpt')?.textContent).toContain('<script>boom()</script>');
    expect((globalThis as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  test('the registry’s card actions reach the card that is showing (copy · ask AI · last good)', async () => {
    const copied: string[] = [];
    const asked: string[] = [];
    const back: unknown[] = [];
    const lg = { at: 1 };
    expect(bus.runErrorOp('copy')).toBe(false); // no card yet: nothing answers
    await mount(
      <CanvasErrorCard
        canvas="ui/Pricing.tsx"
        kind="syntax"
        error={ERROR}
        lastGood={lg}
        onAskAi={(t: string) => asked.push(t)}
        onGoBack={(x: unknown) => back.push(x)}
        onCopy={async (t: string) => {
          copied.push(t);
          return true;
        }}
      />
    );
    expect(bus.runErrorOp('copy')).toBe(true);
    expect(bus.runErrorOp('ask-ai')).toBe(true);
    expect(bus.runErrorOp('last-good')).toBe(true);
    expect(copied).toEqual([errorText(ERROR)]);
    expect(asked[0]).toContain('Pricing');
    expect(back).toEqual([lg]);
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    expect(bus.runErrorOp('copy')).toBe(false); // unmounted: unregistered
  });

  // ── the slot in the viewport: CanvasLoadFailure ─────────────────────────────────────────────
  const route = (
    table: Record<string, { status?: number; body: unknown }>,
    posts: { url: string; body: unknown }[] = []
  ) =>
    (async (url: string, init?: { body?: string }) => {
      const key = Object.keys(table).find((k) => url.startsWith(k));
      if (init?.body) posts.push({ url, body: JSON.parse(init.body) });
      if (!key) return new Response('{}', { status: 404 });
      const { status = 200, body } = table[key];
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;

  test('a canvas that failed to load: the server’s error, the lines around it, one card', async () => {
    const fetchImpl = route({
      '/_api/canvas-errors': { body: { canvas: '.design/ui/Pricing.tsx', errors: [ERROR] } },
      '/_api/canvas-source': {
        body: {
          ok: true,
          file: 'ui/Pricing.tsx',
          source: SRC_LINES.join('\n'),
          lines: 220,
          parsed: false,
          artboards: {},
          error: ERROR,
        },
      },
    });
    await mount(
      <CanvasLoadFailure
        canvas="ui/Pricing.tsx"
        fetchImpl={fetchImpl}
        askAiAvailable
        onAskAi={() => {}}
      />
    );
    expect(q('canvas-error-card')).not.toBeNull();
    expect(q('canvas-error-body')?.textContent).toContain("mistake the canvas can't show");
    await open();
    expect(q('canvas-error-excerpt')?.textContent).toContain('<b>{plan.name}</b>');
    expect(q('canvas-error-excerpt')?.textContent).toContain('</span>');
  });

  test('Can view: the server refuses both reads; the card still says its sentence, without details', async () => {
    const refuse = {
      status: 403,
      body: { error: 'read-only', reason: 'read-only', message: 'no' },
    };
    const fetchImpl = route({ '/_api/canvas-errors': refuse, '/_api/canvas-source': refuse });
    await mount(
      <CanvasLoadFailure canvas="ui/Pricing.tsx" fetchImpl={fetchImpl} canEdit={false} />
    );
    expect(q('canvas-error-title')?.textContent).toBe("Pricing can't be drawn right now.");
    await open();
    expect(q('canvas-error-message')).toBeNull();
    expect(q('canvas-error-none')).not.toBeNull();
    // no Go back for someone who may not edit, no Ask AI where there is no AI chat
    expect(q('canvas-error-last-good')).toBeNull();
    expect(q('canvas-error-ask-ai')).toBeNull();
    // the way out that is theirs stays
    expect(q('canvas-load-retry')).toBeNull(); // (no onReload given here)
  });

  test('Last good version posts @last-good, tells the person, and reloads the frame', async () => {
    const posts: { url: string; body: unknown }[] = [];
    const fetchImpl = route(
      {
        '/_api/canvas-errors': {
          body: { canvas: 'x', errors: [{ ...ERROR, line: 0, column: 0 }] },
        },
        '/_api/project/restore': { body: { ok: true, line: 'Went back to 14:05' } },
      },
      posts
    );
    const said: [string, boolean][] = [];
    let reloaded = 0;
    await mount(
      <CanvasLoadFailure
        canvas="ui/Pricing.tsx"
        fetchImpl={fetchImpl}
        onNotify={(m: string, ok: boolean) => said.push([m, ok])}
        onReload={() => reloaded++}
      />
    );
    await open();
    await click(q('canvas-error-last-good'));
    expect(posts).toEqual([
      { url: '/_api/project/restore', body: { path: 'ui/Pricing.tsx', at: '@last-good' } },
    ]);
    expect(said).toEqual([['Went back to 14:05', true]]);
    expect(reloaded).toBe(1);
  });

  test('Last good version with nothing to go back to: said in words, nothing reloads', async () => {
    const fetchImpl = route({
      '/_api/canvas-errors': { body: { canvas: 'x', errors: [] } },
      '/_api/project/restore': { status: 409, body: { ok: false, reason: 'no-last-good' } },
    });
    const said: [string, boolean][] = [];
    let reloaded = 0;
    await mount(
      <CanvasLoadFailure
        canvas="ui/Pricing.tsx"
        fetchImpl={fetchImpl}
        onNotify={(m: string, ok: boolean) => said.push([m, ok])}
        onReload={() => reloaded++}
      />
    );
    // no error on record → the calm sentence, not a guess about the code
    expect(q('canvas-error-body')?.textContent).toContain("didn't finish loading");
    await open();
    await click(q('canvas-error-last-good'));
    expect(said[0][1]).toBe(false);
    expect(said[0][0]).toContain('no earlier version');
    expect(reloaded).toBe(0);
  });

  test('Reload canvas is `canvas-load-retry`, under the fold, and calls onReload — when no mistake is on record', async () => {
    const fetchImpl = route({ '/_api/canvas-errors': { body: { canvas: 'x', errors: [] } } });
    let reloaded = 0;
    await mount(
      <CanvasLoadFailure
        canvas="ui/Pricing.tsx"
        fetchImpl={fetchImpl}
        onReload={() => reloaded++}
      />
    );
    expect(q('canvas-load-retry')).toBeNull();
    await open();
    await click(q('canvas-load-retry'));
    expect(reloaded).toBe(1);
  });

  test('06 ad-edge-syntax: the boards it last drew are dimmed behind the card (dashed, layout only)', async () => {
    const fetchImpl = route({
      '/_api/canvas-errors': { body: { canvas: 'x', errors: [ERROR] } },
      '/_api/canvas-meta': {
        body: {
          layout: {
            artboards: [
              { id: 'a', x: 0, y: 0, width: 403, height: 252 },
              { id: 'b', x: 443, y: 0, width: 234, height: 334 },
              { id: 'c', x: 717, y: 0, width: 109, height: 236 },
            ],
          },
        },
      },
    });
    await mount(<CanvasLoadFailure canvas="ui/Pricing.tsx" fetchImpl={fetchImpl} />);
    const ghosts = q('canvas-error-ghosts');
    expect(ghosts).not.toBeNull();
    expect(ghosts?.getAttribute('aria-hidden')).toBe('true');
    expect(ghosts?.querySelectorAll('rect.v2-err-ghost').length).toBe(3);
    // the card is still the card
    expect(q('canvas-error-title')?.textContent).toBe("Pricing can't be drawn right now.");
  });

  test('a canvas with no stored layout has no ghosts (nothing is invented)', async () => {
    const fetchImpl = route({ '/_api/canvas-errors': { body: { canvas: 'x', errors: [ERROR] } } });
    await mount(<CanvasLoadFailure canvas="ui/Pricing.tsx" fetchImpl={fetchImpl} />);
    expect(q('canvas-error-ghosts')).toBeNull();
  });

  test('Open in editor: the PROJECT-relative path to the door; a refusal is said', async () => {
    const fetchImpl = route({ '/_api/canvas-errors': { body: { canvas: 'x', errors: [ERROR] } } });
    const calls: string[] = [];
    const said: string[] = [];
    const doors = {
      available: true,
      openInEditor: async (rel: string) => {
        calls.push(rel);
        return { ok: false, reason: 'refused', error: 'Switch to this tab first.' };
      },
    };
    await mount(
      <CanvasLoadFailure
        canvas="ui/Pricing.tsx"
        designRel=".design"
        doors={doors}
        fetchImpl={fetchImpl}
        onNotify={(m: string) => said.push(m)}
      />
    );
    await open();
    await click(q('canvas-error-open-editor'));
    expect(calls).toEqual(['.design/ui/Pricing.tsx']);
    expect(said).toEqual(['Switch to this tab first.']);
  });
});

// 06 ad-edge-syntax: the last-good boards, dimmed behind the card — their stored layout, never a render of them.
describe('the last-good ghosts', () => {
  test('ghostBoxes keeps only boxes with all four numbers, from the canvas meta layout', () => {
    expect(
      ghostBoxes({
        layout: {
          artboards: [
            { id: 'a', x: 0, y: 0, width: 403, height: 252 },
            { id: 'b', x: 693, y: 0, width: 234 }, // no height: skipped
            { id: 'c', x: 'x', y: 0, width: 10, height: 10 }, // not a number: skipped
            { id: 'd', x: 10, y: 20, width: 0, height: 5 }, // empty: skipped
          ],
        },
      })
    ).toEqual([{ id: 'a', x: 0, y: 0, w: 403, h: 252 }]);
    expect(ghostBoxes(null)).toEqual([]);
    expect(ghostBoxes({ layout: {} })).toEqual([]);
  });
});
