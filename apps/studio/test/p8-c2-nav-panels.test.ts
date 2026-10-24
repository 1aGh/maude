// p8-c2 nav panels — the 11 Projects and Navigation rows that are model/CSS facts: jump rows 22 px, the trash
// view's headings + Restore, the Now-row clash, the A/B circles, the ⌘K palette's words and glyphs, the
// deep-link toast. (Render-level Home behaviour lives in p8-c2-nav-home.test.tsx.)
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { applyShellNavigate } from '../client/shell-events.js';
import { BOARD_H, ROW_H, rowHeight } from '../client/v2/canvases/tree-model.js';
import { remoteRows } from '../client/v2/search/search-model.js';
import { startRows } from '../client/v2/search/search-recent.js';
import { STICONS } from '../client/shell/icons.jsx';

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');
const rule = (css: string, selector: string) => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};

describe('pn-jump: artboard rows are 22 px, type-xs', () => {
  test('a board row is shorter than a canvas row', () => {
    expect(BOARD_H).toBe(22);
    expect(rowHeight({ type: 'board' })).toBe(22);
    expect(rowHeight({ type: 'canvas' })).toBe(ROW_H);
  });
  test('the board name is xs, the current one fg-0 with an accent-text icon', () => {
    const css = read('client/v2/canvases/canvases.css');
    expect(rule(css, '.cv-row--board .cv-name')).toContain('var(--type-xs)');
    expect(rule(css, '.cv-row--board.is-sel .cv-bk')).toContain('var(--accent-text)');
  });
  test('the current row is accent-muted and semibold (pn-organise)', () => {
    const r = rule(read('client/v2/canvases/canvases.css'), '.cv-row.is-sel');
    expect(r).toContain('var(--accent-muted)');
    expect(r).toContain('var(--w-semibold)');
  });
});

describe('pn-trash: sentence-case headings, Restore without a hover', () => {
  const css = read('client/v2/left-panel/left-panel.css');
  test('no uppercase heading', () => {
    expect(rule(css, '.lp-trash-grp')).not.toContain('uppercase');
  });
  test('Restore is not hidden at rest', () => {
    expect(css).not.toMatch(/\.lp-trash-item \.lp-restore \{[^}]*opacity: 0/);
  });
  test('a row leads with a thumbnail', () => {
    expect(read('client/v2/left-panel/trash-view.jsx')).toContain('lp-trash-thumb');
  });
});

describe('pn-history: the Now row keeps its column; A/B are circles', () => {
  const css = read('client/v2/history/history.css');
  test('button.vh-now-t.vh-row restores the column the .vh-row cascade took away', () => {
    const r = rule(css, 'button.vh-now-t.vh-row');
    expect(r).toContain('flex-direction: column');
    expect(r).toContain('align-items: flex-start');
    expect(r).toContain('font-size: var(--type-xs)');
  });
  test('the mark is an 18 px circle on the picture, not an inline chip', () => {
    const r = rule(css, '.cmp-mark');
    expect(r).toContain('width: 18px');
    expect(r).toContain('var(--radius-pill)');
    expect(r).toContain('position: absolute');
    expect(read('client/v2/history/history-panel.jsx')).not.toMatch(/<strong>\s*<Mark/);
  });
  test('the selected version is accent-muted', () => {
    expect(rule(css, '.vh-row[aria-current="true"]')).toContain('var(--accent-muted)');
  });
  test('the panel is 372 wide (app.jsx)', () => {
    expect(read('client/app.jsx')).toContain("rightActive === 'changes' ? 372");
  });
});

describe('⌘K: esc key, 620 wide, kit glyphs', () => {
  test('the field ends in esc and the card is 620', () => {
    expect(read('client/dialogs/command-palette.jsx')).toContain('<Kbd>esc</Kbd>');
    expect(rule(read('client/v2/search/search.css'), '.st-palette--search')).toContain('620px');
  });
  test('the close-match note is a box with a search glyph', () => {
    expect(rule(read('client/v2/search/search.css'), '.st-pal-note')).toContain('var(--bg-3)');
    expect(read('client/dialogs/command-palette.jsx')).toMatch(
      /st-pal-note[\s\S]{0,200}StIcon name="search"/
    );
  });
  test('an artboard wears its kind glyph; a print one the printer', () => {
    const rows = remoteRows({
      rows: [
        { key: 'a/p.tsx#front', group: 'artboards', name: 'front', kind: 'print' },
        { key: 'a/p.tsx#web', group: 'artboards', name: 'web', kind: 'web' },
      ],
    });
    expect(rows[0].icon).toBe('print');
    expect(rows[1].icon).toBe('frame');
    for (const g of ['print', 'frame', 'system', 'insert']) expect(STICONS[g]).toBeTruthy();
  });
  test('Start here: plus · folder · insert · help (never the chevron fallback)', () => {
    const ids = ['canvas.new', 'project.open', 'import.figma', 'help.shortcuts'];
    const rows = startRows(ids.map((id) => ({ id, name: id, icon: 'chevron-right', run() {} })));
    expect(rows.map((r) => r.icon)).toEqual(['plus', 'folder', 'insert', 'help']);
  });
  test('a design-system row wears the system glyph', () => {
    expect(read('client/v2/search/search-ds.js')).toContain("icon: 'system'");
  });
});

describe('pn-deeplink: a link to an artboard says where it came from', () => {
  test('the toast carries the canvas and the artboard', () => {
    const said: string[] = [];
    applyShellNavigate(
      { canvas: 'ui/Pozvanka.tsx', artboard: 'story' },
      {
        paths: ['.design/ui/Pozvanka.tsx'],
        designRel: '.design',
        activePath: null,
        openLinkedFile() {},
        openTab() {},
        frameFor: () => null,
        setPresent() {},
        schedule: (fn: () => void) => fn(),
        toast: (t: string) => said.push(t),
      }
    );
    expect(said).toEqual(['Opened from a link — Pozvanka · story.']);
  });
});
