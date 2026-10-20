// V2-4.gate polish A — the Phase 4 gate's design-critic + a11y findings that are structure, copy or CSS
// wiring (the contrast pairs live in shell-text-contrast.test.ts).
//
//   - the no-canvas empty state speaks the contract's words and exposes no port or version
//   - the project pill's absolute-island rule cannot leak onto other `.st-pill` badges
//   - a modal sheet / panel stacks above the informational callouts, below scrims and warnings
//   - the "?" sheet's grid cannot blow out (`minmax(0, 1fr)`), and Settings body copy is not mono
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

let Viewport: (props: Record<string, unknown>) => React.ReactElement;
beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Viewport = (await import('../client/shell/viewport.jsx')).Viewport as unknown as typeof Viewport;
});
afterAll(() => GlobalRegistrator.unregister());

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

async function mountViewport(props: Record<string, unknown> = {}) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <Viewport
        tabs={[]}
        activePath={null}
        registerIframe={() => {}}
        project="e2e-fixture"
        cfg={{}}
        previewPath={null}
        {...props}
      />
    );
  });
  return host;
}

describe('the no-canvas empty state', () => {
  test('says one true thing in the contract’s words — canvas, never screen', async () => {
    const el = await mountViewport();
    const text = el.textContent ?? '';
    expect(el.querySelector('.st-empty-title')?.textContent).toBe('No canvas open');
    expect(el.querySelector('.st-empty-body')?.textContent).toBe(
      'Open a canvas from the Canvases panel, or start a new one.'
    );
    // the v1 words and facts that were wrong or private to a terminal
    for (const gone of [
      'screen',
      'Design system',
      'hold ',
      'Right-click',
      'localhost',
      'CANVAS ·',
      'maude',
    ]) {
      expect(text.includes(gone), gone).toBe(false);
    }
    expect(/\bv\d+\.\d+/.test(text)).toBe(false);
    expect(/:\d{4}\b/.test(text)).toBe(false);
  });

  test('the quick-setup button is still there when setup is incomplete', async () => {
    const el = await mountViewport({ showQuickSetup: true, onStartQuickSetup: () => {} });
    expect(el.querySelector('[data-testid="st-empty-start-quick-setup"]')).toBeTruthy();
  });
});

describe('class collisions and stacking (CSS wiring)', () => {
  test('the project pill’s island rule is scoped to `.st-pill.island`, never bare `.st-pill`', () => {
    const css = read('../client/v2/shell/project-pill.css');
    expect(css).toMatch(/\.st-pill\.island\s*\{\s*position:\s*absolute/);
    expect(css).not.toMatch(/(^|\n)\s*\.st-pill\s*\{/);
  });

  test('the tree group count uses its own class, not `.st-pill`', () => {
    const tree = read('../client/tree/tree.jsx');
    const css = read('../client/styles/3-shell-maude.css');
    expect(tree).toContain('className="st-sec-count"');
    expect(tree).not.toMatch(/className="st-pill"/);
    expect(css).not.toMatch(/\.st-tree-sec-hd \.st-pill/);
  });

  test('Diagnostics stacks above the informational callouts and below scrims and warnings', () => {
    const dg = read('../client/v2/diagnostics/diagnostics.css');
    const co = read('../client/v2/shell/callouts.css');
    const sheet = Number(dg.match(/\.dg-sheet\s*\{[^}]*?z-index:\s*(\d+)/)?.[1]);
    const info = Number(co.match(/\.st-callouts\s*\{[^}]*?z-index:\s*(\d+)/)?.[1]);
    const warn = Number(
      co.match(/\.st-callouts:has\(\.st-callout--warn[^{]*\{[^}]*?z-index:\s*(\d+)/)?.[1]
    );
    const scrim = Number(
      read('../client/styles/3-shell-maude.css').match(/\.st-scrim\s*\{[^}]*?z-index:\s*(\d+)/)?.[1]
    );
    expect(sheet).toBeGreaterThan(info);
    expect(sheet).toBeLessThan(scrim);
    expect(sheet).toBeLessThan(warn);
  });

  test('the "?" sheet’s three columns cannot blow out the container', () => {
    const css = read('../client/v2/search/search.css');
    // S11.18 (? sheet W2): the groups flow down three CSS columns instead of a grid — a column box never
    // grows past its share, and a group never splits across two columns.
    expect(css).toMatch(/\.so-columns--3\s*\{\s*display:\s*block;\s*column-count:\s*3;/);
    expect(css).toMatch(/\.so-columns > \.so-section\s*\{[^}]*break-inside:\s*avoid/);
    expect(css).toMatch(/\.so-columns > \.so-section\s*\{\s*min-width:\s*0/);
    expect(css).toMatch(/\.so-overlay--v2 \.so-combos\s*\{[^}]*flex-wrap:\s*wrap/);
  });

  test('Settings body copy is the body font; the v1 cards are re-pointed in the components layer', () => {
    const css = read('../client/v2/settings/settings.css');
    expect(css).toMatch(/\.v2s-sheet\s*\{\s*font-family:\s*var\(--font-body\)/);
    expect(css).toMatch(/@layer components\s*\{\s*\.v2s-sheet\s+\.v2s-main\s+:where\(/);
    expect(css).not.toMatch(/\.v2s-group-t\s*\{[^}]*text-transform:\s*uppercase/);
  });

  test('eyebrows are the island title: sans, sentence case (no mono caps)', () => {
    const shell = read('../client/styles/3-shell-maude.css');
    const search = read('../client/v2/search/search.css');
    const rule = (css: string, sel: string) =>
      css.slice(css.indexOf(`${sel} {`), css.indexOf('}', css.indexOf(`${sel} {`)));
    for (const [css, sel] of [
      [shell, '.st-tree-sec-hd .st-sec-name'],
      [shell, '.st-pal-group'],
      [shell, '.so-section-hd'],
      [search, '.so-sub'],
    ] as const) {
      const r = rule(css, sel);
      expect(r, sel).not.toMatch(/text-transform:\s*uppercase/);
      expect(r, sel).not.toMatch(/font-mono/);
    }
  });

  test('the keycap is the kit’s: body font, 20px high, 20px wide at minimum', () => {
    const css = read('../client/styles/4-components-maude.css');
    const rule = css.slice(
      css.indexOf('.maude .kbd {'),
      css.indexOf('}', css.indexOf('.maude .kbd {'))
    );
    expect(rule).toMatch(/font-family:\s*var\(--font-body\)/);
    expect(rule).toMatch(/min-width:\s*20px/);
    expect(rule).toMatch(/height:\s*20px/);
  });

  test('row actions reveal on hover or keyboard focus only', () => {
    const css = read('../client/styles/3-shell-maude.css');
    for (const sel of ['.st-row-del', '.st-row-menu-btn']) {
      const rest = css.slice(css.indexOf(`${sel} {`), css.indexOf('}', css.indexOf(`${sel} {`)));
      expect(rest, sel).toMatch(/opacity:\s*0/);
      expect(css).toContain(`.st-row-wrap:hover ${sel}`);
      // keyboard focus on the row reveals it; a mouse click (which focuses without :focus-visible) does not
      expect(css).toContain(`.st-row-wrap:has(:focus-visible) ${sel}`);
    }
  });
});
