// S4.11 — the small toolbar above a selected arrow (canvas 15 `an-arrow-kinds` cell 2): Straight ·
// Curved · Elbow, the head picker, two-way, inks 4 + "+5", Lock. Every choice goes through the one
// store entry (`applyToStrokes`, one undo record) and writes only the drawing.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AnnotationContextToolbar } from '../annotations-context-toolbar.tsx';
import { StrokesStoreContext, type StrokesStoreValue } from '../annotations-layer.tsx';
import type { ArrowStroke, Stroke } from '../annotations-model.ts';
import {
  AnnotationSelectionProvider,
  useAnnotationSelection,
} from '../use-annotation-selection.tsx';

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

const arrow = (o: Partial<ArrowStroke> = {}): ArrowStroke => ({
  id: 'a1',
  tool: 'arrow',
  color: '#1f1f1f',
  width: 3,
  x1: 0,
  y1: 0,
  x2: 100,
  y2: 60,
  ...o,
});

interface Call {
  ids: readonly string[];
  patches: Array<Partial<Stroke> | null>;
  label?: string;
}

function Select({ id }: { id: string }) {
  const sel = useAnnotationSelection();
  // biome-ignore lint/correctness/useExhaustiveDependencies: select once
  useEffect(() => sel.replace(id), []);
  return null;
}

async function mountToolbar(strokes: Stroke[]) {
  const calls: Call[] = [];
  const store = {
    strokes,
    setStrokes: () => {},
    updateStroke: () => {},
    deleteStrokes: () => {},
    translateStrokes: () => {},
    applyToStrokes: (
      ids: readonly string[],
      fn: (s: Stroke) => Partial<Stroke> | null,
      label?: string
    ) => {
      calls.push({ ids, patches: strokes.filter((s) => ids.includes(s.id)).map(fn), label });
    },
    groupSelection: () => null,
    ungroupSelection: () => {},
    setLocked: () => {},
  } as unknown as StrokesStoreValue;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <AnnotationSelectionProvider>
        <StrokesStoreContext.Provider value={store}>
          <Select id="a1" />
          <AnnotationContextToolbar editingId={null} />
        </StrokesStoreContext.Provider>
      </AnnotationSelectionProvider>
    )
  );
  return { host, calls };
}
const click = async (el: Element | null) => {
  if (!el) throw new Error('no such control');
  await act(async () => (el as HTMLElement).click());
};

describe('the arrow toolbar', () => {
  test('Straight · Curved · Elbow: the arrow’s line is pressed, a click writes lineType only', async () => {
    const { host, calls } = await mountToolbar([arrow({ lineType: 'curved' })]);
    const seg = (k: string) => host.querySelector(`[data-testid="annot-arrow-kind-${k}"]`);
    expect(['straight', 'curved', 'elbow'].map((k) => seg(k)?.textContent)).toEqual([
      'Straight',
      'Curved',
      'Elbow',
    ]);
    expect(seg('curved')?.getAttribute('aria-pressed')).toBe('true');
    expect(seg('elbow')?.getAttribute('aria-pressed')).toBe('false');
    await click(seg('elbow'));
    expect(calls.at(-1)?.patches).toEqual([{ lineType: 'elbow' }]);
  });

  test('a bound arrow keeps its binding when its line changes (the patch never names a bind)', async () => {
    const bound = arrow({ endHost: { ref: 'el:desktop/cta', label: 'Cta' } });
    const { host, calls } = await mountToolbar([bound]);
    await click(host.querySelector('[data-testid="annot-arrow-kind-straight"]'));
    const patch = calls.at(-1)?.patches[0] ?? {};
    expect(Object.keys(patch)).toEqual(['lineType']);
  });

  test('two-way gives the start the end’s head; pressed once both ends have one', async () => {
    const { host, calls } = await mountToolbar([arrow()]);
    const two = host.querySelector('[data-testid="annot-arrow-two-way"]');
    expect(two?.getAttribute('aria-pressed')).toBe('false');
    await click(two);
    expect(calls.at(-1)?.patches).toEqual([{ startHead: 'triangle', endHead: 'triangle' }]);
  });

  test('the head picker names the six heads', async () => {
    const { host } = await mountToolbar([arrow()]);
    await click(host.querySelector('button[aria-label^="Arrowhead"]'));
    const labels = [...host.querySelectorAll('[role^="menuitem"]')].map((n) =>
      n.getAttribute('aria-label')
    );
    expect(labels).toEqual(['None', 'Line', 'Triangle', 'Triangle outline', 'Circle', 'Diamond']);
  });

  test('inks: four up front, "+5" opens the other five in place', async () => {
    const { host, calls } = await mountToolbar([arrow()]);
    const inks = () =>
      host.querySelectorAll('[data-testid^="annot-arrow-ink-"]:not([data-testid$="more"])');
    expect(inks()).toHaveLength(4);
    const more = host.querySelector('[data-testid="annot-arrow-ink-more"]');
    expect(more?.textContent).toBe('+5');
    await click(more);
    expect(inks()).toHaveLength(9);
    expect(host.querySelector('[data-testid="annot-arrow-ink-more"]')).toBeNull();
    await click(host.querySelector('[data-testid="annot-arrow-ink-green"]'));
    expect(calls.at(-1)?.patches).toEqual([{ color: '#30a46c' }]);
  });

  test('Lock is still on it', async () => {
    const { host } = await mountToolbar([arrow()]);
    expect(host.querySelector('[data-testid="annot-ctx-lock"]')).not.toBeNull();
  });
});
