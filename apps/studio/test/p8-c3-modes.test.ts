// P8 stage C round 3 (area: Preview purity, menus, Present) - each pin is a fail-first test of the visible
// difference the stage-D critics listed: 04 X1 (Preview draws no Edit chrome), X7 (Present menu), X8 (AI tag
// copy), X9 (esc leaves one segment on), 14 M / 01 (context menus), 10 S1 (Comments icon only with comments).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArtboardActivityOverlay } from '../artboard-activity-overlay.tsx';
import type { ContextTarget } from '../context-menu.tsx';
import { ContextMenuView } from '../context-menu.tsx';
import { artboardMenuSections } from '../editing/artboard-menu.tsx';
import { objectMenuSections } from '../editing/object-menu.tsx';
import { WebOverlayContent } from '../web-overlay-content.tsx';

const src = (f: string) => readFileSync(join(import.meta.dir, '..', f), 'utf8');
const RECT = { x: 0, y: 0, w: 1440, h: 900 };

describe('04 X1 - Preview draws no Edit chrome', () => {
  test('the web breakpoint chip is Edit chrome: gone when the mode hides object tools', () => {
    const Chip = WebOverlayContent;
    const on = renderToStaticMarkup(
      createElement(Chip, { rect: RECT, kind: 'web', visibility: {} })
    );
    expect(on).toContain('≤ 1440px');
    const off = renderToStaticMarkup(
      createElement(Chip, { rect: RECT, kind: 'web', visibility: { editChrome: false } })
    );
    expect(off).not.toContain('≤');
  });
  test('DCArtboard hands the overlay and the growth tag the mode (object-tools cell)', () => {
    const lib = src('canvas-lib.tsx');
    expect(lib).toContain("modeShows(governedMode, 'object-tools')");
    expect(lib).toContain('editChrome: artboardEditChrome');
    expect(lib).toContain('delta={artboardEditChrome ? growth : null}');
  });
  test('the right corner icon (Inspector) is not drawn in Preview, 04 draws left + AI only', () => {
    const corner = src('client/v2/shell/corner-icons.jsx');
    expect(corner).toContain('folded');
    expect(corner).toContain("folded && rightTarget === 'inspector'");
    expect(src('client/app.jsx')).toContain('folded={panelsFolded && !panelsUserHidden}');
  });
  test('the Hide-panels toggle is pressed by the person hiding, never by Preview folding', () => {
    expect(src('client/v2/shell/share-cluster-host.jsx')).toContain(
      'panelsHidden={panelsUserHidden}'
    );
  });
  test('Comment / annotation tools in Preview: no hover rim, no selection rim, no size tag', () => {
    const ov = src('inspect-overlay.tsx');
    expect(ov).toContain('data-maude-annotating');
    expect(ov).toContain('body[data-maude-annotating="true"] .dc-cv-halo');
  });
});

describe('04 X7 - the Present menu', () => {
  test('352 wide, the first row (Present from the selection) carries the accent-muted highlight', () => {
    const css = src('client/v2/shell/share-cluster.css');
    const menu = css.slice(css.indexOf('.st-mode-menu {'), css.indexOf('.st-mode-menu-hd {'));
    expect(menu).toContain('width: 352px');
    expect(css).toContain('.st-mode-menu .st-pm-row[data-hl="true"]');
    expect(src('client/v2/shell/mode-switch.jsx')).toContain(
      "data-hl={row.kind === 'selection' ? 'true' : undefined}"
    );
  });
});

describe('04 X9 - esc leaves one segment on', () => {
  test('a segment that loses its pressed state while focused gives the focus up', () => {
    const ms = src('client/v2/shell/mode-switch.jsx');
    expect(ms).toContain('lostPressed');
    expect(ms).toContain('.blur()');
  });
});

describe('04 X8 - the AI tag speaks as the AI', () => {
  test("`AI's new <artboard> - shown live`, not `editing - <file>`", () => {
    const html = renderToStaticMarkup(
      createElement(ArtboardActivityOverlay, { rect: RECT, label: 'Desktop', active: true })
    );
    expect(html).toContain('AI’s new Desktop — shown live');
    expect(html).not.toContain('editing —');
  });
  test('canvas-lib names the artboard, not the file or the agent, in the tag', () => {
    const lib = src('canvas-lib.tsx');
    expect(lib).toContain('label={label}');
    expect(lib).not.toContain('label={activityLabel}');
  });
});

describe('10 S1 - the Comments icon is drawn only when the canvas has comments', () => {
  test('ShareCluster hides it on commentsShown=false and keeps it by default', async () => {
    const { ShareCluster } = await import('../client/v2/shell/share-cluster.jsx');
    const props = { faces: [], status: null, ctx: {}, run: () => {} };
    const off = renderToStaticMarkup(
      createElement(ShareCluster, { ...props, commentsShown: false })
    );
    expect(off).not.toContain('share-cluster-comments');
    const on = renderToStaticMarkup(createElement(ShareCluster, props));
    expect(on).toContain('share-cluster-comments');
  });
  test('the host passes the open count of the active canvas and the open panel', () => {
    const host = src('client/v2/shell/share-cluster-host.jsx');
    expect(host).toContain('commentsShown=');
    expect(host).toContain('activeOpenComments');
  });
});

// ── context menus (14 ed-ab-menu / ed-obj-order, 01 cf-duplicate-width) ───────────────────────────
const TARGET: ContextTarget = {
  kind: 'artboard-chrome',
  el: null,
  cdId: null,
  artboardId: 'a',
  clientX: 10,
  clientY: 10,
};
const noop = () => {};
const abDeps = {
  duplicate: noop,
  duplicateAtWidth: noop,
  customWidth: noop,
  rename: noop,
  resetPosition: noop,
};
const v1AB = [
  [{ id: 'add-comment', label: 'Add comment', onSelect: noop }],
  [{ id: 'export-artboard', label: 'Export this artboard…', onSelect: noop }],
  [
    {
      id: 'delete-artboard',
      label: 'Delete artboard',
      shortcut: '⌫',
      destructive: true,
      onSelect: noop,
    },
  ],
];
const abMenu = () => artboardMenuSections(v1AB, abDeps);
const flat = (secs: ReturnType<typeof abMenu>) => secs.flat();

describe('14 M - context menus: icon column, Move to trash, no stray focus ring', () => {
  test('artboard menu rows wear the board glyphs (spark, duplicate, web, edit, export, trash)', () => {
    const rows = new Map(flat(abMenu()).map((r) => [r.id, r]));
    expect(rows.get('ask-ai')?.icon).toBe('spark');
    expect(rows.get('duplicate-artboard')?.icon).toBe('duplicate');
    expect(rows.get('duplicate-at-width')?.icon).toBe('web');
    expect(rows.get('rename-artboard')?.icon).toBe('edit');
    expect(rows.get('export-artboard')?.icon).toBe('export');
    expect(rows.get('delete-artboard')?.icon).toBe('trash');
  });
  test('14 owns the artboard menu: Move to trash is a plain row with ⌫, not a red one', () => {
    const del = flat(abMenu()).find((r) => r.id === 'delete-artboard');
    expect(del?.label).toBe('Move to trash');
    expect(del?.shortcut).toBe('⌫');
    expect(del?.destructive).toBeFalsy();
  });
  test('object menu: spark / duplicate / frame / lock / eye-off / trash, Remove plain with ⌫', () => {
    const v1 = [
      [
        { id: 'duplicate-element', label: 'Duplicate', onSelect: noop },
        { id: 'delete-element', label: 'Delete', destructive: true, onSelect: noop },
      ],
    ];
    const secs = objectMenuSections(v1, {
      elementsFor: () => [],
      run: noop,
      selectMatching: noop,
    });
    const rows = new Map(secs.flat().map((r) => [r.id, r]));
    expect(rows.get('ask-ai-object')?.icon).toBe('spark');
    expect(rows.get('duplicate-element')?.icon).toBe('duplicate');
    expect(rows.get('frame')?.icon).toBe('frame');
    expect(rows.get('lock')?.icon).toBe('lock');
    expect(rows.get('hide')?.icon).toBe('eye-off');
    expect(rows.get('delete-element')?.icon).toBe('trash');
    expect(rows.get('delete-element')?.destructive).toBeFalsy();
  });
  test('the view draws an icon column (aligned even for rows without a glyph)', () => {
    const html = renderToStaticMarkup(
      createElement(ContextMenuView, { target: TARGET, sections: abMenu(), onClose: noop })
    );
    expect(html).toContain('dc-menu-ic');
    expect(html.match(/<svg/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    // Copy / Paste rows are text-only: the column keeps its place
    expect(html).toContain('dc-menu-ic" aria-hidden="true"></span>');
  });
  test('the flyout parent and hover read accent-muted; a mouse open does not paint a focus ring', () => {
    const cm = src('context-menu.tsx');
    expect(cm).toContain('.dc-context-menu .dc-menu-item[aria-expanded="true"]');
    expect(cm).toContain('var(--maude-hud-accent-muted');
    expect(cm).toContain('el.focus({ preventScroll: true })');
    expect(cm).not.toContain('firstBtn?.focus()');
  });
  test('the right-clicked artboard / object is selected under its menu', () => {
    const sh = src('canvas-shell.tsx');
    const at = sh.indexOf('onContextMenu: ({ clientX, clientY })');
    const body = sh.slice(at, at + 1800);
    expect(body).toContain('selSet.replace(');
    expect(body).toContain("modeShows(canvasModeStore(window).get().mode, 'object-tools')");
  });
});
