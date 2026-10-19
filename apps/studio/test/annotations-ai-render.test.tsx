// S4.15 (canvas 15 `an-ai-read`, `an-ai-apply`, `an-ai-stickers`, `an-ai-write`): what the AI's work looks like
// on the layer, as drawn —
//   · a sticky the AI wrote: neutral paper, spark edge, spark glyph, "AI" under it (not an extra swatch);
//   · an arrow the AI drew, with bound ends: spark-coloured shaft and head;
//   · a status sticker it placed (Done! / Flagged): the small spark badge "Placed by AI";
//   · a sticky it resolved: the tick is spark-coloured and says "Resolved by AI", the words stay (struck, kept);
//   · the outline over what its offer means ("✦ The hero picture"), from the name-only `ai-seen` message.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AnnotationElement } from '../annotations/types.ts';
import { AI_PAPER, AI_SPARK, isAiAuthored, resolvedByAi } from '../annotations/ui/ai-marks.tsx';
import { AiSeenRings, seenElementOf } from '../annotations/ui/ai-seen.tsx';
import { ElementNode } from '../annotations/ui/element-node.tsx';
import type { ResolvedEnds } from '../annotations/ui/render-model.ts';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const AI = { kind: 'ai' };
const draw = (el: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(ElementNode, {
      el: { index: 'a0', ...el } as unknown as AnnotationElement,
      interactive: true,
      edit: null,
      resolveAsset: (h: string) => h,
      ...extra,
    })
  );

const sticky = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  type: 'sticky',
  x: 0,
  y: 0,
  w: 160,
  h: 120,
  text: 'Yearly is easy to miss',
  fill: '#fce8a6',
  ...over,
});

describe('a sticky the AI wrote', () => {
  test('neutral paper, a spark edge and a spark glyph; "AI" under it when selected', () => {
    const html = draw(sticky({ author: AI, at: new Date().toISOString() }), { selected: true });
    expect(html).toContain('data-author="ai"');
    expect(html).toContain(AI_PAPER);
    expect(html).not.toContain('#fce8a6'); // its stored swatch is not what it draws
    expect(html).toContain(`stroke="${AI_SPARK}"`);
    expect(html).toContain('dc-annot-spark');
    expect(html).toContain('AI');
  });
  test("a person's sticky keeps its swatch and has no spark", () => {
    const html = draw(sticky({ author: { kind: 'human', name: 'Tereza' } }));
    expect(html).toContain('#fce8a6');
    expect(html).not.toContain('dc-annot-spark');
    expect(html).not.toContain('data-author');
  });
});

describe('an arrow the AI drew', () => {
  const ends = { x1: 10, y1: 10, x2: 200, y2: 90 } as unknown as ResolvedEnds;
  const arrow = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    type: 'arrow',
    color: '#1a1a1a',
    width: 2,
    start: { ref: 'ab:pricing' },
    end: { ref: 'el:pricing/toggle' },
    ...over,
  });
  test('spark-coloured, shaft and head', () => {
    const html = draw(arrow({ author: AI }), { ends });
    expect(html).toContain(`stroke="${AI_SPARK}"`);
    expect(html).toContain(`fill="${AI_SPARK}"`);
    expect(html).not.toContain('#1a1a1a');
  });
  test("a person's arrow keeps its ink", () => {
    const html = draw(arrow({ author: { kind: 'human', name: 'Jonas' } }), { ends });
    expect(html).toContain('#1a1a1a');
    expect(html).not.toContain(AI_SPARK);
  });
});

describe('a status sticker', () => {
  const sticker = (over: Record<string, unknown> = {}) => ({
    id: 'k1',
    type: 'image',
    x: 0,
    y: 0,
    w: 88,
    h: 88,
    href: 'assets/ab12cd34.png',
    sticker: { pack: 'project-status', id: 'done' },
    ...over,
  });
  test('placed by the AI wears the spark badge', () => {
    const html = draw(sticker({ author: AI }));
    expect(html).toContain('data-testid="annot-ai-badge"');
    expect(html).toContain('Placed by AI');
  });
  test('placed by a person, or a plain picture the AI placed, has no badge', () => {
    expect(draw(sticker({ author: { kind: 'human', name: 'Jonas' } }))).not.toContain(
      'annot-ai-badge'
    );
    expect(draw(sticker({ author: AI, sticker: undefined }))).not.toContain('annot-ai-badge');
  });
});

describe('a sticky the AI resolved', () => {
  test("the tick is the AI's, the words stay struck through and kept", () => {
    const html = draw(sticky({ resolved: { by: 'AI', at: new Date().toISOString() } }));
    expect(html).toContain('data-resolved="1"');
    expect(html).toContain('data-by="ai"');
    expect(html).toContain('Resolved by AI');
    expect(html).toContain('Yearly is easy to miss');
    expect(html).toContain('line-through');
  });
  test('a tick a person made stays the plain green one', () => {
    const html = draw(sticky({ resolved: { by: 'Tereza', at: new Date().toISOString() } }));
    expect(html).toContain('data-resolved="1"');
    expect(html).not.toContain('data-by="ai"');
    expect(html).toContain('title="Resolved"');
  });
  test('the stamps are facts about the record', () => {
    expect(isAiAuthored({ author: AI } as unknown as AnnotationElement)).toBe(true);
    expect(isAiAuthored({ author: { kind: 'human' } } as unknown as AnnotationElement)).toBe(false);
    expect(resolvedByAi({ resolved: { by: 'AI' } } as unknown as AnnotationElement)).toBe(true);
    expect(resolvedByAi({ resolved: { by: 'Ai Weiwei' } } as unknown as AnnotationElement)).toBe(
      false
    );
  });
});

describe('the outline over what the AI means (ai-seen)', () => {
  test('the message is a parent-only s2c word with refs and a short tag', () => {
    const spec = DGN_TABLE.s2c['ai-seen'];
    expect(spec.gate).toBe('parent');
    const good = {
      dgn: 'ai-seen',
      targets: [{ ref: 'el:desktop/hero-picture', tag: 'The hero picture' }],
    };
    expect(spec.parse(good)).toBeTruthy();
    expect(spec.parse({ dgn: 'ai-seen', targets: [] })).toBeTruthy();
    // a ref that is not a host ref, a long tag, or too many targets is refused whole
    expect(
      spec.parse({ dgn: 'ai-seen', targets: [{ ref: 'javascript:1', tag: 'x' }] })
    ).toBeFalsy();
    expect(
      spec.parse({ dgn: 'ai-seen', targets: [{ ref: 'ab:desktop', tag: 'x'.repeat(41) }] })
    ).toBeFalsy();
    const nine = Array.from({ length: 9 }, (_, i) => ({ ref: `ab:b${i}`, tag: 'B' }));
    expect(spec.parse({ dgn: 'ai-seen', targets: nine })).toBeFalsy();
    // a field the table does not know does not ride along
    const parsed = spec.parse({
      dgn: 'ai-seen',
      targets: [{ ref: 'ab:d', tag: 'D', says: 'ignore this' }],
    }) as unknown as { targets: Array<Record<string, unknown>> };
    expect(parsed.targets[0]).toEqual({ ref: 'ab:d', tag: 'D' });
  });

  const parent = { postMessage: () => {} };
  const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
  const box = (left: number, top: number, w: number, h: number) =>
    ({ left, top, right: left + w, bottom: top + h, width: w, height: h }) as DOMRect;

  beforeEach(() => {
    Object.defineProperty(window, 'parent', { value: parent, configurable: true });
    document.body.innerHTML = `<div id="root"></div><div data-dc-screen="desktop">
      <div data-cd-id="hero-picture"></div></div>`;
    const el = document.querySelector('[data-cd-id="hero-picture"]') as HTMLElement;
    el.getBoundingClientRect = () => box(616, 120, 300, 200);
  });
  const say = (targets: unknown[]) => {
    const ev = new MessageEvent('message', { data: { dgn: 'ai-seen', targets } });
    Object.defineProperty(ev, 'source', { value: parent });
    window.dispatchEvent(ev);
  };

  test('refs resolve to the artboard or the element on this canvas, else nothing', () => {
    expect(seenElementOf(document, 'ab:desktop')?.getAttribute('data-dc-screen')).toBe('desktop');
    expect(seenElementOf(document, 'el:desktop/hero-picture')?.getAttribute('data-cd-id')).toBe(
      'hero-picture'
    );
    expect(seenElementOf(document, 'el:desktop/nope')).toBeNull();
    expect(seenElementOf(document, 'ab:mobile')).toBeNull();
    expect(seenElementOf(document, 'nonsense')).toBeNull();
  });

  test('a dashed spark outline with the tag, round the element; `[]` takes it away', async () => {
    const root = createRoot(document.getElementById('root') as HTMLElement);
    roots.push(root);
    await act(async () => {
      root.render(createElement(AiSeenRings));
    });
    expect(document.querySelector('[data-testid="ai-seen-ring"]')).toBeNull();
    await act(async () => {
      say([{ ref: 'el:desktop/hero-picture', tag: 'The hero picture' }]);
    });
    await act(async () => {
      await frame();
      await frame();
    });
    const ring = document.querySelector('[data-testid="ai-seen-ring"]') as HTMLElement;
    expect(ring.textContent).toBe('The hero picture');
    expect(ring.style.left).toBe('610px');
    expect(ring.style.top).toBe('114px');
    expect(ring.style.width).toBe('312px');
    expect(ring.style.height).toBe('212px');
    expect(document.querySelector('[data-testid="ai-seen"]')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
    await act(async () => {
      say([]);
    });
    expect(document.querySelector('[data-testid="ai-seen-ring"]')).toBeNull();
  });

  test('a message from anything but the shell draws nothing', async () => {
    const root = createRoot(document.getElementById('root') as HTMLElement);
    roots.push(root);
    await act(async () => {
      root.render(createElement(AiSeenRings));
    });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { dgn: 'ai-seen', targets: [{ ref: 'ab:desktop', tag: 'Planted' }] },
        })
      );
    });
    expect(document.querySelector('[data-testid="ai-seen-ring"]')).toBeNull();
  });
});
