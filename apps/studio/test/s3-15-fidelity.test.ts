// S3.15 — S3 fidelity fixes, round 2 (04 Modes verifier gaps). The pure halves, each written red first:
//   · md-preview-combine  the host's scroll-0 clamp leaves a web artboard's body alone while previewing
//   · md-esc              esc's selection rung CLEARS an inspection (Edit steps one level up)
//   · md-model            the Inspect panel opens only for a selection the canvas marked as inspected
//   · md-edit             the link chip sits right of the selection, clear of the name/size tag above it
//   · md-keys             one key renderer: Zoom in reads ⌘+, modifiers in Apple order ⌃⌥⇧⌘
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { ACTIONS_BY_ID } from '../actions/index.ts';
import { formatChord } from '../actions/keys.ts';
import { escClearsSelection } from '../bridge/esc-ladder.ts';
import { inspectOpensOnSelect } from '../client/v2/inspect/inspect-model.js';
import { buildHelpSheet } from '../client/v2/search/help-model.js';
import { keyHint, menuCtx } from '../client/v2/shell/project-menu-model.js';
import { inspectedSelection } from '../inspect-canvas.ts';
import { linkChipPosition } from '../link-chip-overlay.tsx';
import { clampsEngineScroll } from '../preview/wheel-scroll.ts';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

/** The three nodes the clamp looks at, as the engine builds them. */
function board(kind: string) {
  const host = document.createElement('div');
  const artboard = document.createElement('div');
  artboard.className = 'dc-artboard';
  artboard.setAttribute('data-dc-kind', kind);
  const body = document.createElement('div');
  body.className = 'dc-artboard-body';
  artboard.appendChild(body);
  host.appendChild(artboard);
  return { host, artboard, body };
}

describe('md-preview-combine · the scroll-0 clamp', () => {
  test('Edit: every engine clip layer is clamped, as before', () => {
    const { host, artboard, body } = board('web');
    expect(clampsEngineScroll(host, host, 'edit')).toBe(true);
    expect(clampsEngineScroll(body, host, 'edit')).toBe(true);
    expect(clampsEngineScroll(artboard, host, 'edit')).toBe(true);
    expect(clampsEngineScroll(body, host, null)).toBe(true); // a canvas no shell governs
  });

  test('Preview: a web artboard body scrolls inside itself; nothing else is released', () => {
    const { host, artboard, body } = board('web');
    expect(clampsEngineScroll(body, host, 'preview')).toBe(false);
    expect(clampsEngineScroll(host, host, 'preview')).toBe(true);
    expect(clampsEngineScroll(artboard, host, 'preview')).toBe(true);
  });

  test('Preview: a print or social artboard body stays clamped', () => {
    for (const kind of ['print', 'social', 'video']) {
      const { host, body } = board(kind);
      expect(clampsEngineScroll(body, host, 'preview'), kind).toBe(true);
    }
  });

  test('Present holds the camera, not a native scroll: the clamp stays on', () => {
    const { host, body } = board('web');
    expect(clampsEngineScroll(body, host, 'present')).toBe(true);
  });

  test('a scroller deeper inside a mock is no engine clip at all', () => {
    const { host, body } = board('web');
    const inner = document.createElement('div');
    body.appendChild(inner);
    expect(clampsEngineScroll(inner, host, 'preview')).toBe(false);
  });
});

describe('md-esc · the selection rung', () => {
  test('Edit steps one level up first; Preview, Viewing clear the inspection outright', () => {
    expect(escClearsSelection('edit')).toBe(false);
    expect(escClearsSelection('preview')).toBe(true);
    expect(escClearsSelection('viewing')).toBe(true);
  });
  test('a canvas no shell governs keeps v1’s step-out', () => {
    expect(escClearsSelection(null)).toBe(false);
  });
});

describe('md-model · an Edit selection is not an inspection', () => {
  const sel = { id: 'cta', artboardId: 'home' };
  test('a ⌘-click in Preview (or a click in Viewing) marks the selection inspected', () => {
    expect(inspectedSelection(sel, 'preview', 'browse')).toMatchObject({
      id: 'cta',
      inspected: true,
    });
    expect(inspectedSelection(sel, 'viewing', 'inspect')).toMatchObject({ inspected: true });
  });
  test('Edit’s selection stays unmarked (and is not mutated)', () => {
    const out = inspectedSelection(sel, 'edit', 'move');
    expect(out).toBe(sel);
    expect('inspected' in out).toBe(false);
  });
  test('the panel opens in Preview/Viewing only for an inspected selection', () => {
    expect(inspectOpensOnSelect({ mode: 'preview', hasId: true, inspected: true })).toBe(true);
    expect(inspectOpensOnSelect({ mode: 'viewing', hasId: true, inspected: true })).toBe(true);
    // the selection made in Edit, carried into Preview
    expect(inspectOpensOnSelect({ mode: 'preview', hasId: true, inspected: false })).toBe(false);
    expect(inspectOpensOnSelect({ mode: 'preview', hasId: true })).toBe(false);
    expect(inspectOpensOnSelect({ mode: 'edit', hasId: true, inspected: true })).toBe(false);
    expect(inspectOpensOnSelect({ mode: 'present', hasId: true, inspected: true })).toBe(false);
  });
});

describe('md-edit · the link chip clears the name/size tag', () => {
  test('it sits to the right of the selection, inside its vertical span — never above it', () => {
    const r = { right: 400, top: 200, height: 42 };
    const p = linkChipPosition(r);
    expect(p.left).toBeGreaterThan(r.right);
    // the tag lives above the top edge; the chip (26 px high) starts at or below it
    expect(p.top).toBeGreaterThanOrEqual(r.top);
    expect(p.top + 26).toBeLessThanOrEqual(r.top + r.height + 8);
  });
});

describe('md-keys · one renderer for every key glyph', () => {
  test('Zoom in reads ⌘+, in the menu hint, the sheet and the palette', () => {
    expect(formatChord('⌘=')).toBe('⌘+');
    expect(formatChord('⌘+')).toBe('⌘+');
    const ctx = menuCtx({ native: true, canvasOpen: true });
    const def = ACTIONS_BY_ID.get('view.zoom-in');
    expect(def).toBeDefined();
    expect(keyHint(def, ctx)).toBe('⌘+');
    const sheet = buildHelpSheet(ctx);
    const row = sheet.groups.flatMap((g) => g.rows).find((r) => r.id === 'view.zoom-in');
    expect(row?.keys).toEqual(['⌘+']);
    expect(row?.alt ?? []).toEqual([]);
  });

  test('modifiers are always ⌃⌥⇧⌘, whatever order they were written in', () => {
    expect(formatChord('⇧⌥⌘↵')).toBe('⌥⇧⌘↵');
    expect(formatChord('⌘⌃⇧⌥K')).toBe('⌃⌥⇧⌘K');
    expect(formatChord('⇧⌥⌘↵', { spaced: true })).toBe('⌥ ⇧ ⌘ ↵');
    expect(formatChord('⌘−')).toBe('⌘−');
    expect(formatChord('⌘0')).toBe('⌘0');
  });
});
