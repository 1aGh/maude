// S11.18 — the carried a11y warnings (Phase 4 gate, a11y-audit.md W-list), one unit check per item:
//   Settings Left/Right radios are one tab stop · Layers treeitems are not tab stops and carry aria-level ·
//   the palette count is the rows drawn · one "Show panels" button when the panels are hidden ·
//   inactive Settings notes keep their colour · the "?" title is an h2 above its h3 groups.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { LayerRow } from '../client/inspector/layers.jsx';
import { SideToggle } from '../client/panels/SettingsPanel.jsx';
import { actionSearchRows, assemble } from '../client/v2/search/search-model.js';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe('Settings › Layout: a radiogroup is one tab stop', () => {
  test('the checked side takes Tab; the other is reached by the arrows', () => {
    const html = renderToStaticMarkup(
      <SideToggle value="right" onChange={() => {}} testId="panel-side-x" labelledBy="l" />
    );
    expect(count(html, /role="radio"/g)).toBe(2);
    expect(count(html, /tabindex="0"/g)).toBe(1);
    expect(count(html, /tabindex="-1"/g)).toBe(1);
    const checked = /<button[^>]*aria-checked="true"[^>]*>(\w+)</.exec(html);
    expect(checked?.[1]).toBe('Right');
    expect(checked?.[0]).toContain('tabindex="0"');
  });
});

describe('Layers: the tree container is the one tab stop', () => {
  const node = (over = {}) => ({
    id: 'a',
    index: 0,
    tag: 'div',
    type: 'box',
    label: 'BOX',
    children: [],
    ...over,
  });
  const props = (n: object, depth: number, selectedId?: string) => ({
    node: n,
    depth,
    selectedId,
    selectedIndex: 0,
    collapsed: new Set<string>(),
    hiddenOverride: new Map(),
    onToggle: () => {},
    onSelect: () => {},
    onHover: () => {},
    onToggleVisibility: () => {},
    onToggleLock: () => {},
  });

  test('a row is tabindex -1 and says its level', () => {
    const tree = node({ children: [node({ id: 'b' })] });
    const html = renderToStaticMarkup(<LayerRow {...(props(tree, 0) as never)} />);
    expect(count(html, /role="treeitem"/g)).toBe(2);
    expect(html).toContain('aria-level="1"');
    expect(html).toContain('aria-level="2"');
    expect(html).not.toMatch(/role="treeitem"[^>]*tabindex="0"/);
    expect(html).not.toMatch(/tabindex="0"[^>]*role="treeitem"/);
  });

  test('only the selected row’s Lock and Hide buttons are tab stops', () => {
    const tree = node({ children: [node({ id: 'b' })] });
    const html = renderToStaticMarkup(<LayerRow {...(props(tree, 0, 'b') as never)} />);
    const buttons = html.match(/<button[^>]*(?:st-layer-lock|st-layer-eye)[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(4);
    expect(count(buttons.join(''), /tabindex="0"/g)).toBe(2);
    expect(count(buttons.join(''), /tabindex="-1"/g)).toBe(2);
  });
});

describe('⌘K: the count is the rows drawn', () => {
  test('a query with more matches than the per-group cap counts what is shown', () => {
    const ctx = menuCtx({ native: true, canvasOpen: true });
    const local = actionSearchRows(ctx, { isRunnable: () => true });
    const res = assemble({ query: 'a', local, canAskAI: false });
    const drawn = res.groups.reduce((n, g) => n + g.rows.length, 0);
    expect(drawn).toBeGreaterThan(0);
    expect(res.total).toBe(drawn);
  });
});

describe('panels hidden: one "Show panels" button', () => {
  test('the corner icons name the panel they open, the Share cluster says Show panels', async () => {
    const src = read('client/v2/shell/corner-icons.jsx');
    expect(src).not.toMatch(/'Show panels'/);
    expect(src).toContain('shows all panels');
    const cluster = read('client/v2/shell/share-cluster.jsx');
    expect(cluster).toContain("'Show panels'");
  });
});

describe('Settings: a disabled row keeps its note readable', () => {
  test('the whole-row opacity is gone; the label and the switch dim instead', () => {
    const css = read('client/v2/settings/settings.css');
    expect(css).toMatch(/\.v2s-sheet \.st-pref-row\.is-disabled \{\s*opacity: 1;/);
    expect(css).toMatch(/\.st-pref-row\.is-disabled \.st-pref-label,/);
  });
});

describe('callouts sit out while a sheet is open', () => {
  test('a modal anywhere in the document is what makes the stack inert', async () => {
    const { anyModalOpen } = await import('../client/v2/shell/callouts.jsx');
    const none = { querySelector: () => null };
    const one = {
      querySelector: (sel: string) => (sel === '[aria-modal="true"]' ? ({} as object) : null),
    };
    expect(anyModalOpen(none as never)).toBe(false);
    expect(anyModalOpen(one as never)).toBe(true);
    expect(anyModalOpen(undefined as never)).toBe(false);
  });

  test('the stack carries the inert attribute from that state', () => {
    expect(read('client/v2/shell/callouts.jsx')).toMatch(
      /data-testid="callouts" inert=\{modalOpen\}/
    );
  });
});

describe('the "?" sheet', () => {
  test('its title is an h2, above the h3 group titles', () => {
    const src = read('client/dialogs/shortcuts-overlay.jsx');
    expect(src).toMatch(/<h2 className="so-title">Keyboard shortcuts<\/h2>/);
    expect(src).toMatch(/<h3 className="so-section-hd">/);
  });
});
