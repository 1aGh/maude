// Dogfood follow-up (print artboards) — whole-ARTBOARD selections must carry
// the DCArtboard readBack attrs (`data-dc-kind`, `data-dc-print`, `data-dc-
// fixed`, `data-dc-bg`, …) in `Selection.attrs`, because the Inspector's
// ArtboardKnobs panel pre-fills its Kind picker / paper preset / Hug toggle /
// Style fields from exactly these. ATTR_SKIP deliberately hides `data-dc-*`
// from the generic custom-attributes surface on ORDINARY elements — the bug
// was that the blanket skip also applied to the artboard element itself, so
// every readback silently fell back to its default ('digital', screen
// presets, Hug, empty Bg) no matter what the artboard actually was.
//
// Same happy-dom + hoverTargetToSelection harness as knob-props-authored.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { hoverTargetToSelection } from '../dom-selection.ts';
import type { HoverTarget } from '../input-router.tsx';

function artboardSelection(attrsHtml: string) {
  document.body.innerHTML = `<article class="dc-artboard" data-dc-screen="ab-1" ${attrsHtml}><div>content</div></article>`;
  const el = document.querySelector('[data-dc-screen]') as HTMLElement;
  const target: HoverTarget = { el, cdId: null, artboardId: 'ab-1' };
  return hoverTargetToSelection(target);
}

describe('whole-artboard selection — data-dc-* readback attrs', () => {
  test('data-dc-kind + data-dc-print reach Selection.attrs (the ArtboardKnobs payload)', () => {
    const sel = artboardSelection(
      'data-dc-kind="print" data-dc-print=\'{"paper":"a4","bleedMm":3}\''
    );
    expect(sel.attrs?.['data-dc-kind']).toBe('print');
    expect(sel.attrs?.['data-dc-print']).toBe('{"paper":"a4","bleedMm":3}');
  });

  test('the other readback attrs come through too (fixed/bg/padding/layout/gap)', () => {
    const sel = artboardSelection(
      'data-dc-kind="digital" data-dc-fixed="true" data-dc-bg="var(--bg-1)" data-dc-padding="16" data-dc-layout="flex-col" data-dc-gap="8"'
    );
    expect(sel.attrs?.['data-dc-fixed']).toBe('true');
    expect(sel.attrs?.['data-dc-bg']).toBe('var(--bg-1)');
    expect(sel.attrs?.['data-dc-padding']).toBe('16');
    expect(sel.attrs?.['data-dc-layout']).toBe('flex-col');
    expect(sel.attrs?.['data-dc-gap']).toBe('8');
  });

  test('an ORDINARY element (no data-dc-screen) keeps the data-dc-* filter', () => {
    document.body.innerHTML =
      '<div data-cd-id="bbbbbbbb" data-dc-kind="print" data-custom="yes">x</div>';
    const el = document.querySelector('[data-cd-id]') as HTMLElement;
    const target: HoverTarget = { el, cdId: 'bbbbbbbb', artboardId: null };
    const sel = hoverTargetToSelection(target);
    // Engine plumbing stays hidden from the generic custom-attributes panel…
    expect(sel.attrs?.['data-dc-kind']).toBeUndefined();
    // …while genuinely custom attributes still surface.
    expect(sel.attrs?.['data-custom']).toBe('yes');
  });

  test('data-dc-screen itself is included for the artboard (harmless, self-describing)', () => {
    const sel = artboardSelection('data-dc-kind="print"');
    expect(sel.attrs?.['data-dc-screen']).toBe('ab-1');
  });
});

// V2-2.8 "fixed artboard loses 24 px" — a FIXED artboard's frame is now its
// label strip + the declared body, so the Inspector's Height (worldH) takes the
// label back out and keeps showing the number it always showed. Layout sizes
// are stubbed: happy-dom has no layout engine.
describe('whole-artboard selection — Height never counts the label strip', () => {
  function sized(fixed: boolean, frameH: number, labelH: number) {
    document.body.innerHTML = `<article class="dc-artboard" data-dc-screen="ab-1" data-dc-kind="digital"${fixed ? ' data-dc-fixed="true"' : ''}><button class="dc-artboard-label sku">Poster</button><div class="dc-artboard-body">x</div></article>`;
    const el = document.querySelector('[data-dc-screen]') as HTMLElement;
    const label = el.querySelector('.dc-artboard-label') as HTMLElement;
    Object.defineProperty(el, 'offsetHeight', { value: frameH });
    Object.defineProperty(el, 'offsetWidth', { value: 1082 });
    Object.defineProperty(label, 'offsetHeight', { value: labelH });
    return hoverTargetToSelection({ el, cdId: null, artboardId: 'ab-1' });
  }

  test('fixed 1080×1350 with a 24 px label: frame 1376 → Height 1352 (border included, as before)', () => {
    const sel = sized(true, 1376, 24);
    expect(sel.worldH).toBe(1352);
    expect(sel.worldW).toBe(1082);
  });

  test('a hug artboard is unchanged: Height is its frame', () => {
    expect(sized(false, 1376, 24).worldH).toBe(1376);
  });
});
