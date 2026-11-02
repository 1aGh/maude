// S3.10a — the link chip (Edit, read-only): "Go to Pricing" / "Opens cal.com/studio" beside the one selected
// element that carries `data-cd-link`. The words come from the attribute (`linkLabel`) plus the artboard labels
// the canvas has; the chip never fetches, never writes, and exists only in Edit (S3-links-format §5 "Chip").
// DOM sections run ungoverned FIRST: the mode store is per-document and turns governed for good on the first
// `set-mode`.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { canvasModeStore } from '../bridge/canvas-mode-store.ts';
import { ALL_CAPS } from '../bridge/canvas-modes.ts';
import {
  artboardLabelIn,
  LinkChipOverlay,
  linkChipWords,
  linkedSelection,
} from '../link-chip-overlay.tsx';
import { type Selection, SelectionSetProvider, useSelectionSet } from '../use-selection-set.tsx';

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const PAGE = `
  <article data-dc-screen="pricing-desktop"><header class="dc-artboard-label">Pricing Desktop</header>
    <div class="dc-artboard-body">
      <button data-cd-id="cta" data-cd-link="#pricing-desktop">Go</button>
      <button data-cd-id="cal" data-cd-link="https://cal.com/studio">Book</button>
      <button data-cd-id="plain">Plain</button>
    </div>
  </article>`;
const sel = (id: string): Selection => ({
  id,
  selector: `[data-cd-id="${id}"]`,
  artboardId: 'pricing-desktop',
});

describe('linkChipWords: the attribute in the canvas’s words', () => {
  test('an artboard link names the artboard by its label; a canvas link by its file; an external one by host + path', () => {
    const labels = (id: string) => ({ 'pricing-desktop': 'Pricing Desktop' })[id];
    expect(linkChipWords('#pricing-desktop', labels)).toBe('Go to Pricing Desktop');
    expect(linkChipWords('#unlabelled', labels)).toBe('Go to unlabelled');
    expect(linkChipWords('site/pricing.tsx#desktop', labels)).toBe('Go to Pricing');
    expect(linkChipWords('site/pricing-plans.tsx', labels)).toBe('Go to Pricing Plans');
    expect(linkChipWords('https://cal.com/studio', labels)).toBe('Opens cal.com/studio');
  });

  test('no link and an invalid link show no chip: nothing the grammar refuses is said as a place', () => {
    for (const raw of [null, undefined, '', 'javascript:alert(1)', 'data:text/html,x', '../x.tsx'])
      expect(linkChipWords(raw)).toBeNull();
  });
});

describe('artboardLabelIn / linkedSelection read the canvas DOM', () => {
  test('the label is the artboard header’s text; the subject is exactly one selected element with a link', () => {
    document.body.innerHTML = PAGE;
    expect(artboardLabelIn(document, 'pricing-desktop')).toBe('Pricing Desktop');
    expect(artboardLabelIn(document, 'nope')).toBeUndefined();
    expect(linkedSelection(document, [sel('cta')])?.raw).toBe('#pricing-desktop');
    expect(linkedSelection(document, [sel('plain')])).toBeNull();
    expect(linkedSelection(document, [sel('cta'), sel('cal')])).toBeNull();
    expect(linkedSelection(document, [])).toBeNull();
  });
});

async function mount(selected: Selection[]): Promise<void> {
  document.body.innerHTML = PAGE;
  function Seed() {
    const s = useSelectionSet();
    // biome-ignore lint/correctness/useExhaustiveDependencies: seed once
    useEffect(() => s.replace(selected), []);
    return null;
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <SelectionSetProvider postTarget={null}>
        <Seed />
        <LinkChipOverlay />
      </SelectionSetProvider>
    )
  );
  await act(async () => new Promise((r) => setTimeout(r, 60)));
}
const chip = () => document.querySelector<HTMLElement>('[data-testid="edit-link-chip"]');

describe('LinkChipOverlay on an ungoverned canvas (reads as Edit)', () => {
  test('one linked element selected: the chip says where it goes and never takes the pointer', async () => {
    await mount([sel('cta')]);
    expect(chip()?.textContent).toContain('Go to Pricing Desktop');
    expect(getComputedStyle(chip() as HTMLElement).pointerEvents).toBe('none');
  });

  test('an external link reads "Opens cal.com/studio"; a plain element or two selected: no chip', async () => {
    await mount([sel('cal')]);
    expect(chip()?.textContent).toContain('Opens cal.com/studio');
    await mount([sel('plain')]);
    expect(chip()).toBeNull();
    await mount([sel('cta'), sel('cal')]);
    expect(chip()).toBeNull();
  });
});

describe('LinkChipOverlay follows the shell’s mode — Edit only', () => {
  const fakeParent = { postMessage: () => {} };
  let realParent: PropertyDescriptor | undefined;
  beforeAll(() => {
    realParent = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { configurable: true, get: () => fakeParent });
  });
  afterAll(() => {
    if (realParent) Object.defineProperty(window, 'parent', realParent);
    else Reflect.deleteProperty(window, 'parent');
  });
  const setMode = (mode: string) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: fakeParent as unknown as Window,
          data: {
            dgn: 'set-mode',
            v: 2,
            seq: canvasModeStore(window).get().modeSeq + 1,
            mode,
            present: null,
            caps: ALL_CAPS,
          },
        })
      );
    });

  test('Edit shows the chip; Preview, Viewing and back to Edit', async () => {
    await mount([sel('cta')]);
    setMode('edit');
    expect(chip()).not.toBeNull();
    setMode('preview');
    expect(chip()).toBeNull();
    setMode('viewing');
    expect(chip()).toBeNull();
    setMode('edit');
    await act(async () => new Promise((r) => setTimeout(r, 60))); // the next frame puts it back
    expect(chip()).not.toBeNull();
  });
});
