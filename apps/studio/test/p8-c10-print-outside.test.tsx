// P8 stage C round 10 (p8-c10-print) — the print overlay's UN-CLIPPED layer. The kind overlay clips at the artboard
// (overflow hidden), so the board's legend under the paper ("Bleed 3 mm · trim · safe margin 5 mm", 08 / 10), the
// dashed print-area outline and the crop marks (15 an-print) had nowhere to draw. A second layer, same mount, no clip.
//
// decision:maude/v2-p8-c10-print-outside-layer

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ArtboardGuidesOverlay, registerKindOutsideOverlay } from '../artboard-guides-overlay.tsx';
import '../print-overlay-content.tsx';
import { printLegendWords } from '../print-overlay-content.tsx';

const RECT = { x: 100, y: 50, w: 419, h: 581 };
const A6 = { paper: 'a6', orientation: 'portrait', bleedMm: 3 };

const html = (print: Record<string, unknown> | undefined, viewPrint: boolean, kind = 'print') =>
  renderToStaticMarkup(
    <ArtboardGuidesOverlay
      rect={RECT}
      kind={kind as 'print'}
      print={print as never}
      visibility={{ print: viewPrint }}
    />
  );

describe('the legend words', () => {
  test('bleed, trim and the safe margin in mm, from the artboard’s own print prop', () => {
    expect(printLegendWords(A6)).toBe('Bleed 3 mm · trim · safe margin 5 mm');
    expect(
      printLegendWords({ ...A6, bleedMm: 5, marginsMm: { top: 8, right: 8, bottom: 8, left: 8 } })
    ).toBe('Bleed 5 mm · trim · safe margin 8 mm');
  });
  test('margins that differ read as a range, never one side’s number', () => {
    expect(printLegendWords({ ...A6, marginsMm: { top: 5, right: 5, bottom: 5, left: 10 } })).toBe(
      'Bleed 3 mm · trim · safe margin 5–10 mm'
    );
  });
});

describe('the un-clipped layer', () => {
  test('guides on: a second layer with the legend, outline and crop marks — NOT clipped', () => {
    const out = html(A6, true);
    const m = out.match(/<div class="dc-artboard-guides dc-artboard-guides--outside"[^>]*>/);
    expect(m).not.toBeNull();
    expect(m?.[0]).not.toContain('overflow:hidden');
    expect(m?.[0]).toContain('pointer-events:none');
    expect(m?.[0]).toContain('aria-hidden="true"');
    expect(out).toContain('Bleed 3 mm · trim · safe margin 5 mm');
    expect(out).toContain('data-print-area');
    expect((out.match(/data-crop-mark/g) ?? []).length).toBe(4);
  });
  test('the legend sits BELOW the paper and the clipped layer still clips', () => {
    const out = html(A6, true);
    const first = out.indexOf('dc-artboard-guides"');
    const clipped = out.slice(first, out.indexOf('dc-artboard-guides--outside'));
    expect(clipped).toContain('overflow:hidden');
    expect(clipped).not.toContain('Bleed 3 mm · trim');
    const legend = out.match(/data-print-legend[^>]*style="([^"]*)"/);
    expect(legend?.[1]).toContain('top:100%');
  });
  test('guides off (View off, no override): no layer at all', () => {
    const out = html(A6, false);
    expect(out).not.toContain('dc-artboard-guides--outside');
    expect(out).not.toContain('Bleed 3 mm');
  });
  test('the artboard’s own switch wins, both ways', () => {
    expect(html({ ...A6, showGuides: true }, false)).toContain('dc-artboard-guides--outside');
    expect(html({ ...A6, showGuides: false }, true)).not.toContain('dc-artboard-guides--outside');
  });
  test('other kinds draw no outside layer', () => {
    expect(html(undefined, true, 'web')).not.toContain('dc-artboard-guides--outside');
  });
});

describe('the registry', () => {
  // no reset: bun test shares one module graph, so clearing the registry would unregister print for the next file
  test('a registered outside renderer mounts un-clipped; a null return mounts no wrapper', () => {
    const mount = () =>
      renderToStaticMarkup(<ArtboardGuidesOverlay rect={RECT} kind="video" visibility={{}} />);
    registerKindOutsideOverlay('video', () => <i data-testid="out" />);
    const out = mount();
    expect(out).toContain('data-testid="out"');
    expect(out).toContain('dc-artboard-guides--outside');
    registerKindOutsideOverlay('video', () => null);
    expect(mount()).not.toContain('dc-artboard-guides--outside');
  });
});
