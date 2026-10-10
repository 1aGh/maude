// V2-2.4 step 2 — every v1 binding is registered under its v2 id, and the pure resolver picks the
// owner v1's listeners picked (V2-1.3 §6 "the resolver reproduces today's handler choice").
// The DOM-level proof is test/characterization/v1-keys.test.ts; this table is the fast, exact
// half: one row per v1 branch, in the document that received the key.
import { describe, expect, test } from 'bun:test';

import { canvasKeyCtx, type FocusProbe, type ShellKeyState, shellKeyCtx } from '../actions/ctx.ts';
import { bindingInDocument, documentIndex } from '../actions/documents.ts';
import { ACTIONS } from '../actions/index.ts';
import { chord, k } from '../actions/keys.ts';
import { resolveChord } from '../actions/resolve.ts';
import type { KeyCtx } from '../actions/types.ts';

const BASE: ShellKeyState = {
  canvasOpen: true,
  timelineVisible: false,
  presenting: false,
  native: false,
  readOnly: false,
  clipSelected: false,
  artboardSelected: false,
  commentFocused: false,
};
const FOCUS: Record<string, FocusProbe> = {
  chrome: { tag: 'BODY' },
  text: { tag: 'INPUT', type: 'search' },
  textarea: { tag: 'TEXTAREA' },
  editable: { tag: 'DIV', editable: true },
  select: { tag: 'SELECT' },
  range: { tag: 'INPUT', type: 'range' },
  button: { tag: 'BUTTON' },
};
const shell = (focus: keyof typeof FOCUS, s: Partial<ShellKeyState> = {}): KeyCtx =>
  shellKeyCtx(FOCUS[focus], { ...BASE, ...s });

// Each document resolves over the actions it handles (V2-2.4: per-document handler maps).
const SHELL_IDS = new Set([
  'search.open',
  'canvases.search',
  'canvases.find',
  'canvases.refresh',
  'canvas.new',
  'canvas.reload',
  'edit.undo',
  'edit.redo',
  'edit.copy',
  'object.remove',
  'view.panels',
  'view.hidden-files',
  'view.design-system',
  'view.comments',
  'history.open',
  'view.inspector',
  'view.timeline-keep-open',
  'ui.step-back',
  'timeline.play',
  'timeline.step',
  'timeline.to-start',
  'timeline.to-end',
  'timeline.prev-keyframe',
  'timeline.next-keyframe',
  'timeline.undo',
  'timeline.redo',
  'timeline.split',
  'export.open',
  'handoff.open',
  'settings.open',
  'ai.chat',
  'help.shortcuts',
  'help.guides',
]);
// Each document resolves the bindings it owns (documents.ts), of the actions it has handlers for.
const SHELL = documentIndex(ACTIONS, 'shell', (id) => SHELL_IDS.has(id));
// input-router's keydown branch: the tool letters, esc, ⌘Z / ⇧⌘Z / ⌘Y.
const ROUTER_ALL = documentIndex(
  ACTIONS,
  'canvas',
  (id) =>
    (id.startsWith('tool.') && id !== 'tool.hand-hold') ||
    ['ui.step-back', 'edit.undo', 'edit.redo'].includes(id)
);
// inspect.ts: what the canvas forwards to the shell.
const FORWARD = documentIndex(
  ACTIONS,
  'canvas',
  (id) => !!ACTIONS.find((a) => a.id === id)?.fromCanvas
);

const R = (index: ReturnType<typeof indexKeys>, spec: string, c: KeyCtx) =>
  resolveChord(index, chord(spec) ?? spec, c)?.action.id ?? null;

describe('shell document (use-keyboard-shortcuts + transport + ⌫ guard)', () => {
  const rows: [string, KeyCtx, string | null][] = [
    ['⌘K', shell('chrome'), 'search.open'],
    ['⌘K', shell('text'), 'search.open'],
    ['⇧⌘K', shell('chrome'), 'search.open'],
    ['⌘Z', shell('chrome'), 'edit.undo'],
    ['⌘Z', shell('chrome', { canvasOpen: false }), null],
    ['⌘Z', shell('text'), null],
    ['⌘Z', shell('range'), null],
    ['⌘Z', shell('select'), 'edit.undo'], // v1's global handler never counted <select> as typing
    ['⌘Z', shell('chrome', { timelineVisible: true }), 'timeline.undo'],
    ['⌘Z', shell('select', { timelineVisible: true }), null], // transport skips <select>, global skips the timeline
    ['⌘Z', shell('range', { timelineVisible: true }), 'timeline.undo'],
    ['⇧⌘Z', shell('chrome'), 'edit.redo'],
    ['⌘Y', shell('chrome'), 'edit.redo'],
    ['⇧⌘Y', shell('chrome'), 'edit.redo'],
    ['⌘Y', shell('chrome', { timelineVisible: true }), 'edit.redo'], // the timeline skip was `z` only
    ['⇧⌘R', shell('text'), 'canvases.refresh'],
    ['⌘R', shell('text'), 'canvas.reload'],
    ['⇧⌘M', shell('chrome'), 'view.comments'],
    ['⇧⌘G', shell('chrome'), 'history.open'],
    ['⇧⌘I', shell('text'), 'view.inspector'],
    ['⇧⌘A', shell('chrome'), null],
    ['⇧⌘A', shell('chrome', { native: true }), 'ai.chat'],
    ['⇧⌘A', shell('chrome', { native: true, readOnly: true }), 'ai.chat'], // swallowed, handler no-ops
    ['⇧⌘E', shell('chrome'), 'export.open'],
    ['⇧⌘H', shell('chrome'), 'handoff.open'],
    ['⌘,', shell('text'), 'settings.open'],
    ['⌘,', shell('chrome', { timelineVisible: true }), 'settings.open'], // its handler runs prev-keyframe first
    ['⇧⌘T', shell('chrome'), 'view.timeline-keep-open'],
    ['⌘C', shell('chrome'), 'edit.copy'],
    ['/', shell('chrome'), 'canvases.search'],
    ['⌘/', shell('chrome'), 'canvases.search'],
    ['/', shell('text'), null],
    ['/', shell('range'), null],
    ['⌘F', shell('chrome'), 'canvases.find'],
    ['⌘F', shell('text'), null],
    ['T', shell('chrome'), 'view.panels'],
    ['T', shell('select'), 'view.panels'],
    ['T', shell('range'), null],
    ['T', shell('textarea'), null],
    ['T', shell('editable'), null],
    ['⇧T', shell('chrome'), null], // v1 bailed on ⇧
    ['H', shell('button'), 'view.hidden-files'],
    ['S', shell('chrome'), 'view.design-system'],
    ['S', shell('chrome', { canvasOpen: false }), 'view.design-system'],
    ['N', shell('chrome'), 'canvas.new'],
    ['?', shell('chrome'), 'help.shortcuts'],
    ['⌘?', shell('chrome'), 'help.shortcuts'],
    ['?', shell('text'), null],
    ['F1', shell('chrome'), 'help.guides'],
    ['⇧F1', shell('chrome'), 'help.guides'],
    ['esc', shell('chrome'), 'ui.step-back'],
    ['esc', shell('text', { presenting: true }), 'ui.step-back'],
    ['⇧esc', shell('chrome'), 'ui.step-back'],
    ['⌫', shell('chrome'), 'object.remove'],
    ['⇧⌫', shell('chrome'), 'object.remove'],
    ['⌦', shell('chrome'), 'object.remove'],
    ['⌫', shell('text'), null],
    ['⌫', shell('select'), null],
    ['⌫', shell('range'), 'object.remove'], // the transport counts a range slider as not typing
    ['⌘⌫', shell('chrome'), null],
    ['⌘⌫', shell('chrome', { timelineVisible: true, clipSelected: true }), 'object.remove'],
    ['Space', shell('chrome'), null],
    ['Space', shell('chrome', { timelineVisible: true }), 'timeline.play'],
    ['Space', shell('range', { timelineVisible: true }), 'timeline.play'],
    ['Space', shell('select', { timelineVisible: true }), null],
    ['Space', shell('text', { timelineVisible: true }), null],
    ['⇧→', shell('chrome', { timelineVisible: true }), 'timeline.step'],
    ['⌘←', shell('chrome', { timelineVisible: true }), 'timeline.step'],
    ['Home', shell('chrome', { timelineVisible: true }), 'timeline.to-start'],
    ['End', shell('chrome', { timelineVisible: true }), 'timeline.to-end'],
    [',', shell('chrome', { timelineVisible: true }), 'timeline.prev-keyframe'],
    ['.', shell('chrome', { timelineVisible: true }), 'timeline.next-keyframe'],
    ['⌘.', shell('chrome', { timelineVisible: true }), 'timeline.next-keyframe'],
    ['⇧⌘Z', shell('chrome', { timelineVisible: true }), 'timeline.redo'],
    ['⌘B', shell('chrome', { timelineVisible: true }), 'timeline.split'],
    ['⌘B', shell('chrome'), null],
    ['C', shell('chrome', { timelineVisible: true }), null], // TimelinePanel's own listener
  ];
  for (const [spec, c, want] of rows)
    test(`${spec} · ${c.focus}${[...c.facts].map((f) => `+${f}`).join('')} → ${want}`, () =>
      expect(R(SHELL, spec, c)).toBe(want));
});

describe('canvas document', () => {
  const inCanvas = canvasKeyCtx({ typing: false, readOnly: false });
  const inText = canvasKeyCtx({ typing: true, readOnly: false });
  const viewer = canvasKeyCtx({ typing: false, readOnly: true });
  describe('input-router (classify)', () => {
    const rows: [string, KeyCtx, string | null][] = [
      ['V', inCanvas, 'tool.select'],
      ['⇧V', inCanvas, 'tool.select'], // classify lower-cased e.key: ⇧ ignored
      ['H', inCanvas, 'tool.hand'],
      ['C', inCanvas, 'tool.comment'],
      ['C', viewer, 'tool.comment'], // still swallowed; setTool refuses it
      ['B', inCanvas, 'tool.pen'],
      ['I', inCanvas, 'tool.highlighter'],
      ['R', inCanvas, 'tool.shape'],
      ['O', inCanvas, 'tool.shape'],
      ['A', inCanvas, 'tool.arrow'],
      ['N', inCanvas, 'tool.sticky'],
      ['T', inCanvas, 'tool.text'],
      ['S', inCanvas, null],
      ['⇧S', inCanvas, 'tool.section'],
      ['E', inCanvas, 'tool.eraser'],
      ['T', inText, null],
      ['⌘T', inCanvas, null],
      ['⌥V', inCanvas, null],
      ['esc', inCanvas, 'ui.step-back'],
      ['⌘esc', inCanvas, 'ui.step-back'],
      ['esc', inText, null],
      ['⌘Z', inCanvas, 'edit.undo'],
      ['⇧⌘Z', inCanvas, 'edit.redo'],
      ['⌘Y', inCanvas, 'edit.redo'],
      ['⇧⌘Y', inCanvas, null],
      ['⌥⌘Z', inCanvas, null],
      ['⌘Z', inText, null],
    ];
    for (const [spec, c, want] of rows)
      test(`${spec} · ${c.focus} role=${c.role} → ${want}`, () =>
        expect(R(ROUTER_ALL, spec, c)).toBe(want));
  });
  describe('inspect.ts forwarder (fromCanvas)', () => {
    const rows: [string, KeyCtx, string | null][] = [
      ['⌘K', inCanvas, 'search.open'],
      ['⌘K', inText, 'search.open'],
      ['⇧⌘K', inCanvas, null], // the forwarder required !shift
      ['⌘R', inText, 'canvas.reload'],
      ['⇧⌘R', inCanvas, null],
      ['⇧⌘I', inCanvas, 'view.inspector'],
      ['⇧⌘M', inCanvas, 'view.comments'],
      ['⇧⌘E', inCanvas, 'export.open'],
      ['⇧⌘H', inCanvas, 'handoff.open'],
      ['⇧⌘T', inCanvas, 'view.timeline-keep-open'],
      ['⇧⌘G', inCanvas, 'history.open'],
      ['⇧⌘A', inCanvas, null],
      ['⌘,', inCanvas, null],
      ['?', inCanvas, null],
      ['F1', inCanvas, null],
    ];
    for (const [spec, c, want] of rows)
      test(`${spec} · ${c.focus} → ${want}`, () => expect(R(FORWARD, spec, c)).toBe(want));
  });
});

describe('registry integrity', () => {
  test('ids are unique, dotted lower-kebab', () => {
    const seen = new Set<string>();
    for (const a of ACTIONS) {
      expect(seen.has(a.id)).toBe(false);
      seen.add(a.id);
      expect(a.id).toMatch(/^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/);
      expect(a.label.trim().length).toBeGreaterThan(0);
    }
  });
  test('every chord is canonical', () => {
    for (const a of ACTIONS)
      for (const b of a.keys ?? []) expect(`${a.id} ${chord(b.chord)}`).toBe(`${a.id} ${b.chord}`);
  });
  test('the primary key of every action is not an alias', () => {
    for (const a of ACTIONS)
      if (a.keys?.length) expect(`${a.id} ${!!a.keys[0].alias}`).toBe(`${a.id} false`);
  });
  test('a fromCanvas action is a shell action with a ⌘ chord the canvas resolves', () => {
    for (const a of ACTIONS.filter((x) => x.fromCanvas)) {
      expect(a.exec).toBe('shell');
      const live = (a.keys ?? []).filter((b) => bindingInDocument(b, 'canvas'));
      expect(live.length).toBeGreaterThan(0);
      for (const b of live) expect(b.chord.includes('⌘')).toBe(true);
    }
  });
  test('k() is the only chord source the defs use (no raw, un-normalised strings)', () => {
    expect(k('⌘ ⇧ G')).toBe('⇧⌘G');
  });
});
