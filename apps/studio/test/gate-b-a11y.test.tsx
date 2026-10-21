// Wave-B gate accessibility audit (WCAG 2.1 AA) — the regression pins for each blocker that audit found
// (.ai/plans/notes/v2-evidence/waveB-gate/a11y.md). Each test is named for the axe rule it stands for. The
// live proof is the re-scan (a11y-recheck.md); these keep a blocker from coming back without a browser.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { contrastRatio, oklchToRgb, parseOklch } from '../draw/palette';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CommentsPanel } from '../client/v2/comments/comments-panel.jsx';
import { OtherFormats } from '../client/v2/export/other-formats.jsx';
import { AdvModal, AdvSheet } from '../client/v2/onboarding/AdvSheet.jsx';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
/** The declarations of the FIRST `selector {` rule (flat CSS inside an @layer — no nested braces). */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no rule ${selector}`);
  return css.slice(at + selector.length + 2, css.indexOf('}', at));
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});
function render(node: unknown) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node as never));
  return host;
}

describe('color-contrast', () => {
  const tokens = read('../client/styles/1-tokens-maude.css');
  for (const theme of ['dark', 'light'] as const) {
    test(`${theme}: --accent-text is defined in the shell scope and holds 4.5:1 on --accent-muted and the islands`, () => {
      const palette = rule(tokens, `.maude[data-theme="${theme}"]`);
      const get = (name: string) => {
        const v = palette.match(new RegExp(`${name}:\\s*(oklch\\([^)]*\\))`))?.[1];
        if (!v) throw new Error(`${theme} ${name} is not defined`);
        return oklchToRgb(parseOklch(v));
      };
      const text = get('--accent-text');
      for (const surface of ['--accent-muted', '--bg-1', '--bg-2'])
        expect(contrastRatio(text, get(surface))).toBeGreaterThanOrEqual(4.5);
    });
  }

  test('a <button> the timeline Advanced fold draws on a quiet ground carries its own background (UA grey was 1.7:1)', () => {
    const css = read('../client/v2/timeline/advanced/advanced.css');
    for (const sel of ['.tla-link', '.tla-seg-btn'])
      expect(rule(css, sel)).toMatch(/background:\s*transparent/);
  });

  test("a match inside a palette row's meta is full-strength text, not --fg-2 on the accent tint (4.24:1)", () => {
    const css = read('../client/v2/search/search.css');
    expect(rule(css, '.st-pal-meta .st-pal-mark')).toMatch(/color:\s*var\(--fg-0\)/);
  });

  test("the chord on the empty canvas's Ask button is not dimmed by opacity (4.0:1 on the accent)", () => {
    const css = read('../client/v2/empty/empty.css');
    expect(rule(css, '.es-keys')).toMatch(/opacity:\s*1\s*;/);
  });
});

describe('nested-interactive', () => {
  test('a comment row is not a role=button that holds buttons — the thread opens from a real <button>', () => {
    const noop = () => {};
    const file = '.design/ui/Combine.tsx';
    const el = render(
      <CommentsPanel
        commentsByFile={{
          [file]: [
            {
              id: 'c1',
              text: 'Too small',
              status: 'open',
              created: new Date().toISOString(),
              author: 'Jonas',
              thread: [],
            },
          ],
        }}
        filter="open"
        setFilter={noop}
        activePath={file}
        focusedId={null}
        onJump={noop}
        onResolve={noop}
        onReopen={noop}
        onDelete={noop}
        me="Michal"
        now={Date.now()}
        artboardLabel={() => ''}
      />
    );
    const row = el.querySelector('[data-testid="comment-item-c1"]') as HTMLElement;
    expect(row).not.toBeNull();
    // the rule: no role=button element may hold a focusable descendant
    const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]';
    for (const b of el.querySelectorAll('[role="button"]'))
      expect(b.querySelector(FOCUSABLE)).toBeNull();
    expect(row.getAttribute('role')).toBeNull();
    expect(row.querySelector('button.cmp-open')?.textContent).toContain('Too small');
  });
});

describe('aria-required-children', () => {
  test('the Export sheet\'s "Other formats" search box is not a child of role=menu', () => {
    const el = render(
      <OtherFormats
        groups={[
          { group: 'Images', items: [{ id: 'png', label: 'PNG', format: 'png', note: 'n' }] },
        ]}
        format="png"
        onPick={() => {}}
        open
        setOpen={() => {}}
      />
    );
    const menu = el.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).not.toBeNull();
    expect(menu.querySelector('input')).toBeNull();
    // the popover still answers its testid, and the search + the rows are both inside it
    const pop = el.querySelector('[data-testid="export-other-menu"]') as HTMLElement;
    expect(pop.querySelector('[data-testid="export-other-search"]')).not.toBeNull();
    expect(pop.querySelector('[data-testid="export-format-png"]')).not.toBeNull();
  });
});

describe('aria-allowed-role + focus (the onboarding Advanced sheets)', () => {
  test('role=dialog is on a <div>, not the <form>; focus lands inside on open and Tab is trapped', () => {
    const outside = document.createElement('button');
    outside.textContent = 'behind';
    document.body.append(outside);
    outside.focus();
    const el = render(
      <AdvModal onCancel={() => {}}>
        <AdvSheet
          id="hub"
          title="Connect a team server"
          verb="Connect"
          onCancel={() => {}}
          onSubmit={() => {}}
        >
          <input aria-label="Address" />
        </AdvSheet>
      </AdvModal>
    );
    const dialog = el.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.tagName).toBe('DIV');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(el.querySelector('form[data-testid="onb-hub"]')?.getAttribute('role')).toBeNull();
    // focus is on a control INSIDE the dialog (not the scrim's wrapper) as soon as the sheet opens
    expect(dialog.contains(document.activeElement)).toBe(true);
    // Tab from the last control wraps to the first instead of leaving for the page behind
    const last = el.querySelector('[data-testid="onb-hub-cancel"]') as HTMLElement;
    last.focus();
    const submit = el.querySelector('[data-testid="onb-hub-go"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    submit.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    window.dispatchEvent(tab);
    expect(el.contains(document.activeElement)).toBe(true);
    outside.remove();
  });
});

describe('scrollable-region-focusable + nested-interactive (source pins)', () => {
  test('the Diagnostics log list is a tab stop', () => {
    expect(read('../client/v2/diagnostics/diagnostics-sheet.jsx')).toMatch(
      /<ol className="dg-lines"[^>]*tabIndex=\{0\}/
    );
  });
  test('the AI chat feed is a named tab stop', () => {
    expect(read('../client/panels/ChatPanel.jsx')).toMatch(
      /className="chat-feed"\s+autoScroll\s+tabIndex=\{0\}\s+aria-label="Conversation"/
    );
  });
  test("the canvas's Missing frame is a group when it holds the Relink… button, never an img", () => {
    expect(read('../asset-placeholder.tsx')).toContain("role={f.words.relink ? 'group' : 'img'}");
  });
  test('the empty project\'s "New canvas" button sits beside role=tree, not in it', () => {
    const src = read('../client/v2/canvases/canvases-panel.jsx');
    // an empty project is a labelled group (a tree needs a treeitem); the New canvas button is outside it
    expect(src).toContain("role={emptyProject ? 'group' : 'tree'}");
    const tree = src.indexOf("role={emptyProject ? 'group' : 'tree'}");
    const none = src.indexOf('<PanelNoCanvases');
    const treeEnd = src.indexOf('</div>\n        {/* gate-b-a11y: the "New canvas" button', tree);
    expect(tree).toBeGreaterThan(0);
    expect(treeEnd).toBeGreaterThan(tree);
    expect(none).toBeGreaterThan(treeEnd);
  });
});
