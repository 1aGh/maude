// V2-8.7 (final re-audit at e308179d0) — the regression pins for what the re-scan found
// (.ai/plans/notes/v2-evidence/V2-8.7-a11y-final.md). Each test is named for the axe rule it stands for.
// Colour pins use the number axe MEASURED (the background it saw), not a guess: the failing combination is
// named in each comment.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { contrastRatio, oklchToRgb, parseOklch } from '../draw/palette';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const STYLES = '../client/styles/1-tokens-maude-v2.css';

/** The oklch value of `--name` inside the theme's token block of the v2 shell tokens. */
function token(theme: 'light' | 'dark', name: string) {
  const css = read(STYLES);
  const at = css.indexOf(`.maude-v2[data-theme="${theme}"] {`);
  if (at < 0) throw new Error(`no ${theme} block`);
  const block = css.slice(at, css.indexOf('\n  }', at));
  const m = new RegExp(`${name}:\\s*(oklch\\([^)]+\\))`).exec(block);
  if (!m) throw new Error(`${theme}: ${name} not declared`);
  return oklchToRgb(parseOklch(m[1]));
}

/** The `var(--x)` a rule's `color` names. */
function colorVar(css: string, selector: string) {
  const at = css.lastIndexOf(`${selector} {`); // the cascade's last rule wins
  if (at < 0) throw new Error(`no rule ${selector}`);
  const body = css.slice(at, css.indexOf('}', at));
  const m = /(?:^|[\s;{])color:\s*var\(\s*(--[\w-]+)/.exec(body);
  if (!m) throw new Error(`no colour var in ${selector}`);
  return m[1];
}

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

describe('color-contrast', () => {
  // The Canvases panel's foot line ("Folders appear when you make one.") wore --fg-3, the DISABLED ink:
  // axe 2.71:1 (#606468 on #1e2124), 11 px. It is information, not a disabled control.
  test('the Canvases panel foot line is not in the disabled ink and holds 4.5:1 on the panel', () => {
    const css = read('../client/v2/canvases/canvases.css');
    const name = colorVar(css, '.cv-foot');
    expect(name).not.toBe('--fg-3');
    expect(contrastRatio(token('dark', name), '#1e2124')).toBeGreaterThanOrEqual(4.5);
  });

  // "Advanced · kept open" chip: --accent-text on --accent-muted over the panel: axe 4.43:1 (#39b0f1 on #234152).
  test('the Advanced "kept open" chip holds 4.5:1 on the accent wash (dark)', () => {
    const css = read('../client/styles/3-kit-maude-v2.css');
    const name = colorVar(css, '.maude .ad-kept');
    expect(contrastRatio(token('dark', name), '#234152')).toBeGreaterThanOrEqual(4.5);
  });

  // A selected design-system row's two lines (name of the system, "3 canvases") in --fg-2 on --accent-tint:
  // axe 4.19:1 (#a1a5a9 on #15445d).
  test('the selected design-system row keeps its sub lines at 4.5:1 on the selection', () => {
    const css = read('../client/v2/left-panel/left-panel.css');
    const name = colorVar(css, '.lp-row[aria-current="true"] .lp-ds-sub');
    expect(contrastRatio(token('dark', name), '#15445d')).toBeGreaterThanOrEqual(4.5);
  });

  // The manual contrast sweep (screenshot with the text hidden, then the real ink against the real pixels):
  // a kind chip with nothing in it ("Fixed size 0") is still a button, but wore --fg-3, the DISABLED ink: 2.29:1
  // (#606468 on #2b2e32). Information, not a disabled control.
  test('a kind chip with a zero count holds 4.5:1 (it is a live filter, not a disabled control)', () => {
    const css = read('../client/v2/kinds/kind-filter.css');
    const name = colorVar(css, '.kf-chip[data-zero]');
    expect(name).not.toBe('--fg-3');
    expect(contrastRatio(token('dark', name), '#2b2e32')).toBeGreaterThanOrEqual(4.5);
  });

  // The "U" (unsaved) badge on a selected canvas row: --fg-2 on the selection wash, 9 px bold: 3.36:1 (#a1a5a9 on #125375).
  test('the unsaved badge on a selected row holds 4.5:1', () => {
    const css = read('../client/v2/left-panel/left-panel.css');
    const name = colorVar(css, '.cv-git-badge[data-kind="U"]');
    expect(contrastRatio(token('dark', name), '#125375')).toBeGreaterThanOrEqual(4.5);
  });

  // Diagnostics › AI setup: "Sign in to Claude" wore --bg-0 (near-black in dark) on the accent fill: axe 3.77:1
  // (#15171a on #0077c2). Text on the accent fill is --accent-fg (white).
  test('the AI-setup "Sign in to Claude" button holds 4.5:1 on the accent fill', () => {
    const css = read('../client/v2/ai/chat.css');
    const name = colorVar(css, '.rdy-signin');
    expect(name).toBe('--accent-fg');
    for (const theme of ['dark', 'light'] as const)
      expect(contrastRatio(token(theme, name), token(theme, '--accent'))).toBeGreaterThanOrEqual(
        4.5
      );
  });

  // What's new (Help › What's new): the kind badge (feature / fix / improvement) in --accent-text on the unseen
  // item's wash: axe 3.97:1 (#39b0f1 on #1a4963), 10 px bold, seven badges.
  test("the What's new kind badges hold 4.5:1 on the item wash (dark)", () => {
    const css = read('../client/v2/help/help.css');
    const name = colorVar(css, '.mdcc-wn-kind');
    expect(name).not.toBe('--accent');
    expect(contrastRatio(token('dark', name), '#1a4963')).toBeGreaterThanOrEqual(4.5);
  });

  // The native tab list: the selected row's second line in --strip-fg-dim (= --fg-2) on --panel-row-on: axe 4.34:1.
  test("the tab list: the selected row's second line holds 4.5:1 (dark)", () => {
    const html = read('../../desktop/src/strip.html');
    const name = colorVar(html, '.row.selected .words span');
    expect(name).toBe('--fg-1');
    const dark = /--fg-1:\s*(oklch\(0\.800[^)]*\))/.exec(html)?.[1];
    expect(dark).toBeTruthy();
    expect(contrastRatio(oklchToRgb(parseOklch(dark as string)), '#234152')).toBeGreaterThanOrEqual(
      4.5
    );
  });
});

describe('aria-input-field-name', () => {
  // The "/" menu is a listbox; a listbox is an input field and needs a name. Its visible group header already
  // says "Slash commands" — the name is that word, not a new one.
  test('the slash menu listbox is named by its own group word', async () => {
    const { CommandPopover } = await import('../client/v2/ai/Composer.jsx');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(
        <CommandPopover
          items={[{ name: 'design:critic', note: 'Review this canvas', group: 'design' }]}
          activeIndex={0}
          onPick={() => {}}
          onHover={() => {}}
        />
      )
    );
    const menu = document.querySelector('[data-testid="chat-cmd-menu"]') as HTMLElement;
    expect(menu.getAttribute('role')).toBe('listbox');
    expect(menu.getAttribute('aria-label')).toBe('Slash commands');
    expect(menu.querySelector('.chat-cmd-group')?.textContent).toBe('Slash commands');
  });
});

describe('aria-required-children', () => {
  // File › Move to… with nowhere to go: the menu's one child was a bare div[aria-disabled] — not a menu item.
  test('"No other folders": no menu without items and no fake item — the popover only says so', async () => {
    const { TreeRowMenu } = await import('../client/tree-row-menu.jsx');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(
        <TreeRowMenu
          state={{ x: 10, y: 10, view: 'move-to' }}
          onClose={() => {}}
          rootItems={[]}
          destinations={[]}
          onPickDestination={() => {}}
        />
      )
    );
    expect(document.querySelector('[role="menu"]')).toBeNull();
    const pop = document.querySelector('[aria-label="Move to…"]') as HTMLElement;
    expect(pop).not.toBeNull();
    expect(pop.textContent).toContain('No other folders');
    expect(pop.querySelector('[role="menuitem"]')).toBeNull();
    expect(pop.querySelector('[tabindex], button')).toBeNull();
  });
});

describe('aria-required-children (empty tree)', () => {
  // full-matrix scan at 3fba09b78, state left-search: a search with no Design-system hit drew
  // `div[role=tree][aria-label="Other project files"]` with no treeitem (axe aria-required-children, critical).
  test('a search with no Design-system hit draws no "Other project files" tree', async () => {
    const { otherFilesGroups } = await import('../client/tree/tree.jsx');
    const groups = [
      { kind: 'canvas', label: 'Canvases', tree: { a: {} } },
      { kind: 'canvas', label: 'Design system', tree: {} },
      { kind: 'project', label: 'Project', tree: { 'README.md': {} } },
    ];
    expect(otherFilesGroups('zzz', false, groups)).toEqual([]);
    expect(otherFilesGroups('zzz', true, groups)).toEqual([]);
    expect(otherFilesGroups('', false, groups)).toEqual([]);
    expect(otherFilesGroups('', true, groups).map((g) => g.label)).toEqual(['Project']);
    const ds = [{ kind: 'canvas', label: 'Design system', tree: { 'tokens.css': {} } }];
    expect(otherFilesGroups('tok', false, ds)).toHaveLength(1);
    // and the tree renders only for a non-empty list
    const src = read('../client/tree/tree.jsx');
    expect(src).toContain('otherFiles.length > 0 ?');
  });
});

describe('label', () => {
  // The file picker the browser lane appends to <body> while its dialog is open (off-screen, so WKWebView
  // presents the panel): axe `label` (critical) — an unnamed form control. It is not a control anyone reaches
  // (the dialog is the control): hide it from the tree and the tab order instead of inventing a name.
  test('the Assets "Add files…" picker is out of the accessibility tree while it is open', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) =>
      String(url).startsWith('/_api/index?part=assets')
        ? new Response(JSON.stringify({ seq: 1, history: 'ready', assets: [] }), { status: 200 })
        : new Response('{}', { status: 200 })) as unknown as typeof fetch;
    try {
      const { AssetsPanel } = await import('../client/v2/left-panel/assets-panel.jsx');
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      roots.push(root);
      await act(async () => root.render(<AssetsPanel designRel=".design" />));
      await act(async () => new Promise((r) => setTimeout(r, 40)));
      const add = host.querySelector('[data-testid="assets-add"]') as HTMLButtonElement;
      expect(add).not.toBeNull();
      await act(async () => add.click());
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input).not.toBeNull();
      expect(input.getAttribute('aria-hidden')).toBe('true');
      expect(input.getAttribute('tabindex')).toBe('-1');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('the report-a-bug and replace-media pickers carry the same two attributes', () => {
    for (const rel of ['../client/report-bug.jsx', '../client/hooks/use-tabs.jsx']) {
      const src = read(rel);
      const at = src.indexOf("input.type = 'file'");
      expect(at).toBeGreaterThan(0);
      const near = src.slice(at, at + 900);
      expect(near).toContain("setAttribute('aria-hidden', 'true')");
      expect(near).toContain('input.tabIndex = -1');
    }
  });
});
