// S3.11 — Inspect and measure (04 Modes · md-inspect). The pure halves: the tool descriptor (the v1 bridge entry
// is gone and `inspect` arms itself), what the router does with it, the modeShows gate for measure, the
// neighbour gap, and the rows of the panel from one fixture element.
import { describe, expect, test } from 'bun:test';

import {
  armTarget,
  escStep,
  MODE_TOOLS,
  REST_TOOL,
  V1_TOOL_BRIDGE,
  visibleSlots,
} from '../bridge/canvas-modes.ts';
import { modeShows } from '../bridge/mode-shows.ts';
import {
  inspectOpensOnSelect,
  inspectRows,
  weightWord,
} from '../client/v2/inspect/inspect-model.js';
import { classify, dragPansCanvas } from '../input-router.tsx';
import { inspectsSelection, neighbourOf, shouldFlipToMove } from '../inspect-canvas.ts';
import { DEFAULT_TOOLS, filterToolsForReadOnly } from '../use-tool-mode.tsx';

describe('the inspect tool descriptor', () => {
  test('the v1 bridge entry is gone; inspect is a tool of its own', () => {
    expect(V1_TOOL_BRIDGE.inspect).toBeUndefined();
    const ids = DEFAULT_TOOLS.map((t) => t.id);
    expect(ids).toContain('inspect' as never);
    expect(armTarget('inspect', (t) => (ids as string[]).includes(t))).toBe('inspect');
  });

  test('Viewing rests on inspect and arms nothing else; a read-only canvas keeps it', () => {
    expect(REST_TOOL.viewing).toBe('inspect');
    expect(MODE_TOOLS.viewing.rest).toBe('inspect');
    const readOnly = filterToolsForReadOnly(DEFAULT_TOOLS, true).map((t) => t.id as string);
    expect(readOnly).toContain('inspect');
    expect(
      visibleSlots('viewing', 'comment', (t) => readOnly.includes(t)).map((s) => s.tool)
    ).toEqual(['inspect']);
  });

  test('esc: in Viewing the resting tool is inspect, so a press at rest stays', () => {
    expect(escStep('viewing', 'inspect')).toBe('stay');
    expect(escStep('viewing', 'comment')).toBe('rest');
  });

  test('a click selects the deepest element and a drag pans, anywhere on the canvas', () => {
    const down = classify({
      type: 'pointerdown',
      button: 0,
      clientX: 10,
      clientY: 20,
      activeTool: 'inspect',
    });
    expect(down).toEqual({ kind: 'select', mode: 'replace', deep: true, clientX: 10, clientY: 20 });
    // Shift does not add: inspect holds one element
    const shift = classify({
      type: 'pointerdown',
      button: 0,
      shiftKey: true,
      clientX: 1,
      clientY: 1,
      activeTool: 'inspect',
    });
    expect(shift).toMatchObject({ kind: 'select', mode: 'replace', deep: true });
    expect(
      classify({ type: 'pointermove', clientX: 5, clientY: 6, activeTool: 'inspect' })
    ).toEqual({ kind: 'hover', deep: true, clientX: 5, clientY: 6 });
    expect(dragPansCanvas('inspect', true)).toBe(true);
    expect(dragPansCanvas('inspect', false)).toBe(true);
  });

  test('Preview: ⌘-click on the design is a deep select (the link is not followed)', () => {
    const r = classify({
      type: 'pointerdown',
      button: 0,
      metaKey: true,
      clientX: 3,
      clientY: 4,
      activeTool: 'browse',
    });
    expect(r).toEqual({ kind: 'select', mode: 'replace', deep: true, clientX: 3, clientY: 4 });
  });
});

describe('a governed Preview keeps its mode when something is inspected', () => {
  test('⌘-click from Browse flips to Move only outside a governed Preview', () => {
    expect(shouldFlipToMove('browse', null)).toBe(true); // an ungoverned canvas: v1's escape hatch
    expect(shouldFlipToMove('browse', 'preview')).toBe(false); // governed: inspect, never Edit
    expect(shouldFlipToMove('move', null)).toBe(false);
  });

  test('a selection is an inspection in Preview and Viewing, with the inspect tool, never in Edit/Present', () => {
    expect(inspectsSelection('preview', 'browse')).toBe(true);
    expect(inspectsSelection('viewing', 'inspect')).toBe(true);
    expect(inspectsSelection('edit', 'move')).toBe(false);
    expect(inspectsSelection('present', 'browse')).toBe(false);
    expect(inspectsSelection(null, 'inspect')).toBe(true); // an ungoverned canvas with the tool armed
    expect(inspectsSelection(null, 'move')).toBe(false);
  });
});

describe('modeShows — measure is on in Edit, Preview and Viewing, off in Present', () => {
  test('the table', () => {
    expect(modeShows('edit', 'measure')).toBe(true);
    expect(modeShows('preview', 'measure')).toBe(true);
    expect(modeShows('viewing', 'measure')).toBe(true);
    expect(modeShows('present', 'measure')).toBe(false);
    expect(modeShows(null, 'measure')).toBe(true); // ungoverned canvas: v1 behaviour
  });
  test('the inspect panel is Preview and Viewing only', () => {
    expect(modeShows('preview', 'inspect-panel')).toBe(true);
    expect(modeShows('viewing', 'inspect-panel')).toBe(true);
    expect(modeShows('edit', 'inspect-panel')).toBe(false);
    expect(modeShows('present', 'inspect-panel')).toBe(false);
  });
});

describe('neighbourOf — the gap to the nearest sibling', () => {
  const self = { x: 100, y: 20, w: 150, h: 48 };
  test('the nearest edge along the axis they overlap on, in world px', () => {
    const near = neighbourOf(
      self,
      [
        { name: 'About', rect: { x: 6, y: 30, w: 46, h: 28 } }, // left, gap 48 screen px
        { name: 'Footer', rect: { x: 100, y: 300, w: 150, h: 40 } }, // below, gap 232
      ],
      1
    );
    expect(near).toEqual({ name: 'About', gap: 48, side: 'left' });
  });
  test('divides by zoom, rounds, skips overlaps and an empty list', () => {
    expect(
      neighbourOf(self, [{ name: 'Nav', rect: { x: 260, y: 20, w: 60, h: 48 } }], 0.5)
    ).toEqual({ name: 'Nav', gap: 20, side: 'right' });
    expect(
      neighbourOf(self, [{ name: 'Over', rect: { x: 120, y: 30, w: 40, h: 20 } }], 1)
    ).toBeNull();
    expect(neighbourOf(self, [], 1)).toBeNull();
  });
});

const bookACall = {
  id: 'book-a-call',
  index: 0,
  tag: 'button',
  text: 'Book a call',
  worldW: 150,
  worldH: 48,
  neighbour: { name: 'About', gap: 48, side: 'left' },
  authored: {
    'background-color': 'var(--ink)',
    color: 'var(--paper)',
    padding: '12px 24px',
    'border-radius': '999px',
  },
  computed: {
    'background-color': 'rgb(17, 17, 17)',
    color: 'rgb(250, 249, 246)',
    'padding-top': '12px',
    'padding-right': '24px',
    'padding-bottom': '12px',
    'padding-left': '24px',
    'border-top-left-radius': '999px',
    'font-family': '"SF Pro Text", system-ui, sans-serif',
    'font-size': '19px',
    'font-weight': '600',
  },
};

describe('inspectRows — one fixture element, the rows 04 md-inspect draws', () => {
  const rows = inspectRows(bookACall, null);
  test('name and kind chip', () => {
    expect(rows.name).toBe('Book a call');
    expect(rows.kind).toBe('Button');
  });
  test('Size and spacing, with the gap to the neighbour named', () => {
    expect(rows.size).toEqual([
      { k: 'Size', v: '150 × 48' },
      { k: 'Padding', v: '12 · 24' },
      { k: 'Corners', v: 'Round' },
      { k: 'Gap to About', v: '48' },
    ]);
  });
  test('Colour and type, with the token names where the CSS uses one', () => {
    expect(rows.colour.map((r) => [r.k, r.v, r.swatch ?? null])).toEqual([
      ['Fill', 'Ink', 'rgb(17, 17, 17)'],
      ['Text', 'SF Pro Text · 19 · Semibold', null],
      ['Text colour', 'Paper', 'rgb(250, 249, 246)'],
    ]);
  });
  test('Advanced CSS is the authored declarations, in order', () => {
    expect(rows.css).toEqual([
      ['background-color', 'var(--ink)'],
      ['color', 'var(--paper)'],
      ['padding', '12px 24px'],
      ['border-radius', '999px'],
    ]);
  });
  test('no neighbour, no gap row; a plain colour reads as hex; transparent fill is no row', () => {
    const r = inspectRows(
      {
        ...bookACall,
        neighbour: null,
        authored: {},
        computed: {
          ...bookACall.computed,
          'background-color': 'rgba(0, 0, 0, 0)',
          color: 'rgb(255, 0, 0)',
        },
      },
      null
    );
    expect(r.size.map((x) => x.k)).toEqual(['Size', 'Padding', 'Corners']);
    expect(r.colour.find((x) => x.k === 'Fill')).toBeUndefined();
    expect(r.colour.find((x) => x.k === 'Text colour')?.v).toBe('#FF0000');
  });
  test('weight words', () => {
    expect([400, 500, 600, 700, 350].map(weightWord)).toEqual([
      'Regular',
      'Medium',
      'Semibold',
      'Bold',
      '350',
    ]);
  });
});

describe('the Inspect panel opens on a selection in Preview and Viewing only', () => {
  test('rule', () => {
    expect(inspectOpensOnSelect({ mode: 'preview', hasId: true })).toBe(true);
    expect(inspectOpensOnSelect({ mode: 'viewing', hasId: true })).toBe(true);
    expect(inspectOpensOnSelect({ mode: 'edit', hasId: true })).toBe(false);
    expect(inspectOpensOnSelect({ mode: 'present', hasId: true })).toBe(false);
    expect(inspectOpensOnSelect({ mode: 'preview', hasId: false })).toBe(false);
  });
});
