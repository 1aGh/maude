// artboard-activity-overlay — Phase 13. Presentational overlay contract.
//
// The positioned overlay only renders inside a laid-out DesignCanvas (rect
// resolves after layout effects, which renderToStaticMarkup doesn't run), so we
// assert the leaf component directly: the rim box, the badge text, and the
// active→fading toggle. The gating decision (present + artboard scope) is
// covered in use-canvas-activity.test.tsx.

import { describe, expect, test } from 'bun:test';

import { renderToStaticMarkup } from 'react-dom/server';

import { ArtboardActivityOverlay } from '../artboard-activity-overlay.tsx';

const RECT = { x: 10, y: 20, w: 300, h: 200 };

describe('artboard-activity-overlay', () => {
  test('renders the rim + badge with the editing label', () => {
    const html = renderToStaticMarkup(
      <ArtboardActivityOverlay rect={RECT} label="Smoke TSX.tsx" active />
    );
    expect(html).toContain('dc-activity-rim');
    expect(html).toContain('dc-activity-badge');
    expect(html).toContain('dc-activity-scan'); // Phase 13.3 full-artboard scan beam
    expect(html).toContain('AI’s new Smoke TSX.tsx — shown live');
    expect(html).toContain('aria-hidden');
  });

  test('agent color overrides the activity CSS var', () => {
    const html = renderToStaticMarkup(
      <ArtboardActivityOverlay rect={RECT} label="Nimble Ferret" active color="#ff9800" />
    );
    expect(html).toMatch(/--mdcc-activity:\s*#ff9800/);
  });

  test('active overlay is NOT marked fading', () => {
    const html = renderToStaticMarkup(<ArtboardActivityOverlay rect={RECT} label="x" active />);
    expect(html).not.toContain('data-fading');
  });

  test('idle overlay carries data-fading for the cross-fade out', () => {
    const html = renderToStaticMarkup(
      <ArtboardActivityOverlay rect={RECT} label="x" active={false} />
    );
    expect(html).toContain('data-fading="true"');
  });

  test('positions at the artboard world rect', () => {
    const html = renderToStaticMarkup(<ArtboardActivityOverlay rect={RECT} label="x" active />);
    expect(html).toMatch(/left:\s*10px/);
    expect(html).toMatch(/top:\s*20px/);
    expect(html).toMatch(/width:\s*300px/);
    expect(html).toMatch(/height:\s*200px/);
  });
});
