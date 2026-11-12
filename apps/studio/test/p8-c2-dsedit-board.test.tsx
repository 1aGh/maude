// P8-C2 dsedit — the Design system canvas bar (13 `DsBar`): a v2 island on the HUD tokens (it used the CSS
// system colours Canvas / CanvasText / Highlight, so it drew WHITE in the dark app and Review… was a
// Highlight pill), with the `system` glyph tile, a `.seg` Light | Dark and Review… as the primary button.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { DsBarView } from '../ds/board/index.tsx';
import type { BoardModel } from '../ds/board/types.ts';

const model = {
  label: 'Studio site system',
  library: null,
  pendingCount: 1,
  tokens: [{ section: 'colour' }],
  themes: { all: ['light', 'dark'], default: 'light', light: 'light', dark: 'dark' },
} as unknown as BoardModel;

const CSS = readFileSync(join(import.meta.dir, '../ds/board/board.css'), 'utf8');
const rule = (sel: string): string => {
  const i = CSS.indexOf(`\n${sel} {`);
  expect(i).toBeGreaterThan(-1);
  return CSS.slice(i, CSS.indexOf('}', i));
};

describe('the Design system bar', () => {
  test('wears the system glyph tile, the sun and moon seg and the primary Review… button', () => {
    const out = renderToStaticMarkup(
      <DsBarView model={model} mode="light" onMode={() => {}} onReview={() => {}} />
    );
    // #225 — the glyph tile and the seg are the canvas pill's own (one island, canvas-theme-pill.tsx)
    expect(out).toContain('class="dc-theme-pill-ic"');
    // 2.0.7 — the seg is two icons (sun, moon) named by aria-label, like the canvas pill
    expect(out).toContain('class="dc-theme-pill-b dc-theme-pill-b--ic"');
    expect(out).toContain('aria-label="Light"');
    expect(out).toContain('aria-label="Dark"');
    expect(out).toContain('ds-bar-review btn btn--primary btn--sm');
  });

  test('is drawn on the HUD island tokens, never on CSS system colours', () => {
    const bar = CSS.slice(
      CSS.indexOf('/* ─── The bar'),
      CSS.indexOf('@media (prefers-reduced-motion')
    );
    expect(bar).not.toMatch(/\b(Canvas|CanvasText|Highlight|HighlightText)\b/);
    // #225 — the island and its glyph tile are the canvas pill's chrome (one copy, in canvas-theme-pill.tsx)
    const pill = readFileSync(join(import.meta.dir, '../canvas-theme-pill.tsx'), 'utf8');
    const pillRule = (sel: string) => pill.match(new RegExp(`\\n${sel}\\{[^}]*\\}`))?.[0] ?? '';
    expect(pillRule('\\.dc-theme-pill')).toContain('var(--maude-hud-island-bg)');
    expect(pillRule('\\.dc-theme-pill')).toContain('min-height:44px');
    expect(pillRule('\\.dc-theme-pill-ic')).toContain('var(--maude-hud-accent-muted)');
    expect(pill.slice(pill.indexOf('const PILL_CSS'), pill.indexOf('`;'))).not.toMatch(
      /\b(Canvas|CanvasText|Highlight|HighlightText)\b/
    );
    expect(rule('.ds-bar-review')).toContain('var(--maude-hud-accent)');
  });
});
