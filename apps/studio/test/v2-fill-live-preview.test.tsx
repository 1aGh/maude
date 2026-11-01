// r3 "I set Fill Blue on a polygon but it's white": the Inspector shows Blue 100 % and the file says blue, but the
// object on the canvas stays white until a reload. The live preview (`apply-style` in canvas-shell.tsx) is plain
// CSSOM: `style.setProperty('background', blue)` followed by `style.removeProperty('background-color')` — a fill's
// patch is `{ background: blue, background-color: null, background-image: null }` — wipes the colour the shorthand
// just set (removing a LONGHAND clears that part of the shorthand), and the reload that would repair it is
// suppressed after an optimistic write. It only happens when the object already carries a colour, because only then
// does the Inspector's `authored` map hold the longhand (CSSOM expands `background: #d4d4d8` into it).
//
// This drives the real write lane (`useCssWrite`) and the real `authored` reader (`styleMapsFor`) against a happy-dom
// element — which expands shorthands like a browser does — and applies every optimistic message exactly as the
// canvas does. Every kind of shape the tools draw, and every section whose patch pairs a shorthand with its longhands.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { applyEdit, applyRemove } from '../canvas-edit.ts';
import { styleMapsFor } from '../dom-selection.ts';
import { type DispatchDeps, dispatchEditOp } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import { cornersToCss, fillToCss } from '../edit-ops/words-paint.ts';

type Write = (patch: Record<string, string | null>) => void;
const posts: Array<{ property: string; value?: string; reset?: boolean }> = [];
type Optimistic = { id: string; prop: string; value: string | null };

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    if (init?.body) posts.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true, previous: null }), { status: 200 });
  }) as never;
});
afterAll(() => GlobalRegistrator.unregister());

const settle = () => act(async () => new Promise((r) => setTimeout(r, 15)));

/** What canvas-shell.tsx does with an `apply-style` message — verbatim. */
function applyStyle(el: HTMLElement, m: Optimistic) {
  if (m.value == null || m.value === '') el.style.removeProperty(m.prop);
  else el.style.setProperty(m.prop, m.value);
}

/** One selection → one write through the Inspector's real lane, applied to the live element. */
async function writeLive(
  el: HTMLElement,
  patch: Record<string, string | null>,
  declared?: Record<string, string>
) {
  const { useCssWrite } = await import('../client/v2/inspector/css-write.js');
  const maps = styleMapsFor(el);
  const target = {
    id: 'shape',
    index: 0,
    file: '.design/ui/ahoj.tsx',
    authored: maps.authored,
    declared: declared ?? maps.declared,
  };
  let write: Write = () => {};
  function Probe() {
    const w = useCssWrite(target, {
      editable: true,
      onOptimistic: (m: Optimistic) => applyStyle(el, m),
      onRecordEdit: () => {},
    });
    useEffect(() => {
      write = w.write as Write;
    });
    return null;
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<Probe />));
  await act(async () => write(patch));
  await settle();
  await act(async () => root.unmount());
}

const BLUE = '#008aff';

/** The drawn shape as the op writes it, as an inline style on a live element. */
async function drawn(kind: string): Promise<HTMLElement> {
  const SRC = `export default function C() { return (<DesignCanvas><DCArtboard id="desktop" label="D" width={800} height={600}></DCArtboard></DesignCanvas>); }`;
  const files = new Map([
    ['ui/C.tsx', `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';\n${SRC}`],
  ]);
  const deps: DispatchDeps = {
    resolve: (f) => (files.has(f.replace(/^\.design\//, '')) ? f.replace(/^\.design\//, '') : null),
    read: (rel) => files.get(rel) ?? null,
    write: async (rel, _before, after) => void files.set(rel, after),
    writeLayout: async () => {},
    heldByAi: () => null,
    log: createWriteLog(),
  };
  const res = await dispatchEditOp(
    {
      op: 'object.insert-shape',
      file: '.design/ui/C.tsx',
      targets: [],
      params: {
        kind,
        artboard: 'desktop',
        rect: { x: 10, y: 20, w: 198, h: 183 },
        ...(kind === 'polygon' ? { sides: 6 } : {}),
      },
    } as never,
    deps
  );
  expect((res as { ok?: boolean }).ok).toBe(true);
  const src = files.get('ui/C.tsx') as string;
  const m =
    /data-shape="[a-z]+" style=\{\{ ([^}]*) \}\}/.exec(src) ?? /style=\{\{ ([^}]*) \}\}/.exec(src);
  const el = document.createElement('div');
  for (const [, k, v] of (m?.[1] ?? '').matchAll(/(\w+): "([^"]*)"/g))
    el.style.setProperty(
      k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
      v
    );
  document.body.append(el);
  return el;
}

/** happy-dom computes a hex as written and a browser as rgb(): compare as one spelling. */
const hex = (c: string) => {
  const m = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/.exec(c);
  return m
    ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`
    : c.toLowerCase();
};
const bg = (el: HTMLElement) => hex(getComputedStyle(el).backgroundColor);

describe('Fill is live on every shape the tools draw', () => {
  for (const kind of ['rectangle', 'ellipse', 'polygon', 'frame']) {
    test(`${kind}: a pick shows its colour on the canvas, the first time and after a reload`, async () => {
      const el = await drawn(kind);
      // first pick: the drawn default is `var(--bg-3, #d4d4d8)` — no longhand in `authored`
      await writeLive(el, fillToCss({ color: { paint: { css: BLUE }, opacity: 100 }, layers: [] }));
      expect(bg(el)).toBe(BLUE);
      // …the file now says `background: #008aff`; after the reload the Inspector reads a longhand from it
      expect(hex(styleMapsFor(el).authored['background-color'])).toBe(BLUE);
      await writeLive(
        el,
        fillToCss({ color: { paint: { css: '#ff3b30' }, opacity: 100 }, layers: [] })
      );
      expect(bg(el)).toBe('#ff3b30');
    });
  }

  test('a gradient layer over the colour keeps the colour and the layer', async () => {
    const el = await drawn('polygon');
    await writeLive(el, fillToCss({ color: { paint: { css: BLUE }, opacity: 100 }, layers: [] }));
    await writeLive(
      el,
      fillToCss({
        color: { paint: { css: BLUE }, opacity: 100 },
        layers: [{ kind: 'gradient', css: 'linear-gradient(180deg, #fff, #000)' }],
      })
    );
    expect(bg(el)).toBe(BLUE);
    expect(el.style.getPropertyValue('background-image')).toContain('linear-gradient');
  });

  // Chrome keeps `background: var(--bg-3, #d4d4d8)` whole and answers getPropertyValue('background') with it but
  // 'background-color' with '' (measured in Chrome; happy-dom drops a var() shorthand, so the report is stubbed here).
  const FRESH = { background: 'var(--bg-3, #d4d4d8)' };

  test('the canvas reports the inline background shorthand as declared', () => {
    const el = document.createElement('div');
    el.style.setProperty('background', '#d4d4d8');
    document.body.append(el);
    expect(styleMapsFor(el).declared?.background).toBeTruthy();
  });

  test('a fresh shape: a gradient keeps the colour live, None clears it', async () => {
    const el = document.createElement('div');
    document.body.append(el);
    posts.length = 0;
    await writeLive(
      el,
      fillToCss({
        color: { paint: { token: '--bg-3', fallback: '#d4d4d8' }, opacity: 100 },
        layers: [{ kind: 'gradient', css: 'linear-gradient(180deg, #fff, #000)' }],
      } as never),
      FRESH
    );
    expect(el.style.getPropertyValue('background-image')).toContain('linear-gradient');
    const sent = Object.fromEntries(posts.map((p) => [p.property, p.reset ? null : p.value]));
    expect(sent['background-color']).toBe('var(--bg-3, #d4d4d8)'); // the colour the row shows is kept…
    expect(sent.background).toBeNull(); // …as a longhand, the shorthand it came from is gone
    const none = document.createElement('div');
    document.body.append(none);
    await writeLive(none, fillToCss({ color: null, layers: [] }), FRESH);
    expect(posts.map((p) => [p.property, p.reset])).toContainEqual(['background', true]);
  });

  test('None clears it and nothing else', async () => {
    const el = await drawn('rectangle');
    await writeLive(el, fillToCss({ color: { paint: { css: BLUE }, opacity: 100 }, layers: [] }));
    await writeLive(el, fillToCss({ color: null, layers: [] }));
    expect(bg(el)).not.toBe(BLUE);
  });
});

describe('the same shorthand-then-longhand patch in the other sections', () => {
  test('Corners: a radius over four radii keeps all four corners', async () => {
    const el = document.createElement('div');
    el.style.setProperty('border-radius', '8px');
    document.body.append(el);
    const px = { px: 12 };
    await writeLive(el, cornersToCss({ tl: px, tr: px, br: px, bl: px }));
    for (const p of [
      'border-top-left-radius',
      'border-top-right-radius',
      'border-bottom-right-radius',
      'border-bottom-left-radius',
    ])
      expect(el.style.getPropertyValue(p)).toBe('12px');
  });

  test('a text colour is one property and stays one write', async () => {
    const el = document.createElement('p');
    el.style.setProperty('color', '#18181b');
    document.body.append(el);
    await writeLive(el, { color: BLUE });
    expect(hex(getComputedStyle(el).color)).toBe(BLUE);
  });
});

describe('the written file: the shape gets the colour', () => {
  for (const kind of ['rectangle', 'ellipse', 'polygon', 'frame']) {
    test(`${kind}: the edit-css writes the lane sent leave \`background: blue\` and no stale longhand`, async () => {
      const el = await drawn(kind);
      el.style.setProperty('background', '#d4d4d8'); // a shape that already carries a literal colour
      const tsx = `<div data-cd-id="shape" style={{ position: "absolute", width: "198px", background: "#d4d4d8", backgroundColor: "#d4d4d8" }} />`;
      posts.length = 0;
      await writeLive(el, fillToCss({ color: { paint: { css: BLUE }, opacity: 100 }, layers: [] }));
      let src = tsx;
      for (const p of posts) {
        const attr = `style.${p.property.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())}`;
        src = p.reset
          ? applyRemove('/c.tsx', src, 'shape', attr).source
          : applyEdit('/c.tsx', src, 'shape', attr, JSON.stringify(p.value)).source;
      }
      expect(src).toContain(`background: "${BLUE}"`);
      expect(src).not.toContain('backgroundColor');
      expect(src).not.toContain('backgroundImage');
    });
  }
});
