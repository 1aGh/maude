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
    ['mode.preview', 'ui.step-back', 'edit.undo', 'edit.redo'].includes(id)
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
    // V2-4 gate (roles), approved delta: v1 ran a commenter's ⌘Z (posted `undo` to a canvas with
    // nothing of theirs on the stack). It still resolves here — the disabled winner swallows the key —
    // and the shell answers with the denial line instead of running it (role-gate.js keyOutcome).
    ['⌘Z', shell('chrome', { readOnly: true }), 'edit.undo'],
    ['⇧⌘Z', shell('chrome', { readOnly: true }), 'edit.redo'],
    ['⌘Z', shell('text'), null],
    ['⌘Z', shell('range'), null],
    ['⌘Z', shell('select'), 'edit.undo'], // v1's global handler never counted <select> as typing
    ['⌘Z', shell('chrome', { timelineVisible: true }), 'edit.undo'], // S7.6: one stack
    ['⌘Z', shell('select', { timelineVisible: true }), null], // transport skips <select>, global skips the timeline
    ['⌘Z', shell('range', { timelineVisible: true }), 'edit.undo'],
    ['⇧⌘Z', shell('chrome'), 'edit.redo'],
    ['⌘Y', shell('chrome'), 'edit.redo'],
    ['⇧⌘Y', shell('chrome'), 'edit.redo'],
    ['⌘Y', shell('chrome', { timelineVisible: true }), 'edit.redo'], // the timeline skip was `z` only
    ['⇧⌘R', shell('text'), 'canvases.refresh'],
    ['⌘R', shell('text'), 'canvas.reload'],
    ['⇧⌘M', shell('chrome'), 'view.comments'],
    // V2-4 gate approved delta (rule 13): Version history moved ⇧⌘G → ⌥⌘H (CONTRACT §1); ⇧⌘G is Remove
    // frame in Edit (the canvas's) and Ungroup annotations in Preview.
    ['⇧⌘G', shell('chrome'), null],
    ['⌥⌘H', shell('chrome'), 'history.open'],
    ['⌥⌘H', shell('text'), 'history.open'],
    ['⇧⌘I', shell('text'), 'view.inspector'],
    // V2-4.5b approved delta (rule 13): Assistant moved ⇧⌘A → ⌘/ (CONTRACT §2 "Ask AI"); v2's ⇧⌘A is
    // Select all annotations. The ⌘/ alias of Search canvases died with it.
    ['⇧⌘A', shell('chrome'), null],
    ['⇧⌘A', shell('chrome', { native: true }), null],
    ['⌘/', shell('chrome', { native: true }), 'ai.chat'],
    ['⌘/', shell('text', { native: true }), 'ai.chat'],
    ['⌘/', shell('chrome', { native: true, readOnly: true }), 'ai.chat'], // swallowed, handler no-ops
    ['⇧⌘E', shell('chrome'), 'export.open'],
    ['⇧⌘H', shell('chrome'), 'handoff.open'],
    ['⌘,', shell('text'), 'settings.open'],
    ['⌘,', shell('chrome', { timelineVisible: true }), 'settings.open'], // its handler runs prev-keyframe first
    ['⇧⌘T', shell('chrome'), 'view.timeline-keep-open'],
    ['⌘C', shell('chrome'), 'edit.copy'],
    ['/', shell('chrome'), 'canvases.search'],
    ['⌘/', shell('chrome'), null], // the browser shell has no AI chat key
    ['/', shell('text'), null],
    ['/', shell('range'), null],
    ['⌘F', shell('chrome'), 'canvases.find'],
    ['⌘F', shell('text'), null],
    // V2-4.1 approved delta (CONTRACT §2 "keys that moved", D17): bare T no longer toggles the Files
    // panel. ⌘\ hides/shows ALL panels (view.panels); T stays unbound until V2-4.5 binds Text.
    ['T', shell('chrome'), null],
    ['T', shell('select'), null],
    ['⌘\\', shell('chrome'), 'view.panels'],
    ['⌘\\', shell('text'), 'view.panels'], // a modifier chord works while typing, like ⇧⌘I
    ['⌘\\', shell('textarea'), 'view.panels'],
    ['T', shell('range'), null],
    ['T', shell('textarea'), null],
    ['T', shell('editable'), null],
    ['⇧T', shell('chrome'), null], // v1 bailed on ⇧
    // V2-4.5b approved delta (rule 13, CONTRACT §2 D4): the shell's H / S / N died with the keys that
    // took them (Hand, Section, Sticky — tool letters, which the shell posts as `set-mode`).
    ['H', shell('button'), null],
    ['S', shell('chrome'), null],
    ['S', shell('chrome', { canvasOpen: false }), null],
    ['N', shell('chrome'), null],
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
    ['⇧⌘Z', shell('chrome', { timelineVisible: true }), 'edit.redo'],
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
  const inPreview = canvasKeyCtx({ typing: false, readOnly: false, mode: 'preview' });
  const inViewing = canvasKeyCtx({ typing: false, readOnly: true, mode: 'viewing' });
  const inPresent = canvasKeyCtx({ typing: false, readOnly: false, mode: 'present' });
  describe('input-router (classify)', () => {
    // V2-4.5b approved delta (rule 13): the letters are the two toolbars' (MODE_TOOLS), bound per
    // mode; B I E O ⇧S and the ⇧-letter aliases are gone (help.ts MOVED_KEYS). Edit's own keys and
    // its crossing N C M A E S; what a crossing DOES is toolKeyAction's (test/tool-keys.test.ts).
    const rows: [string, KeyCtx, string | null][] = [
      ['V', inCanvas, 'tool.select'],
      ['⇧V', inCanvas, null],
      ['H', inCanvas, 'tool.hand'],
      ['F', inCanvas, 'tool.frame'],
      ['R', inCanvas, 'tool.el-shape'], // Edit's Shape (S2.13) — never Preview's R
      ['P', inCanvas, 'tool.el-pen'], // Edit's Pen (S2.14) — never the Marker (M)
      ['T', inCanvas, 'tool.el-text'],
      ['I', inCanvas, 'tool.image'],
      ['⇧I', inCanvas, 'tool.components'], // S2.16's Component picker
      ['C', inCanvas, 'tool.comment'],
      ['C', viewer, 'tool.comment'], // the shell decides (the denial line)
      ['N', inCanvas, 'tool.sticky'],
      ['M', inCanvas, 'tool.pen'],
      ['A', inCanvas, 'tool.arrow'],
      ['E', inCanvas, 'tool.stickers'],
      ['S', inCanvas, 'tool.section'],
      ['B', inCanvas, null],
      ['O', inCanvas, null],
      ['⇧S', inCanvas, null],
      ['H', inPreview, 'tool.browse'],
      ['R', inPreview, 'tool.shape'],
      ['T', inPreview, 'tool.text'],
      ['V', inPreview, 'tool.browse'], // rc.1 #18: Preview's pointer, no crossing
      ['F', inPreview, 'tool.frame'],
      ['I', inPreview, 'tool.image'],
      ['P', inPreview, 'tool.el-pen'], // crosses to Edit's Pen (S2.14)
      ['H', inViewing, 'tool.inspect'],
      ['C', inViewing, 'tool.comment'],
      ['N', inViewing, 'tool.sticky'], // → the denial line
      ['H', inPresent, null],
      ['N', inPresent, null],
      ['⌥⌘P', inCanvas, 'mode.preview'],
      ['⌥⌘P', inPreview, 'mode.preview'],
      ['⌥⌘P', inPresent, null],
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
      ['⇧⌘G', inCanvas, null], // V2-4 gate: moved to ⌥⌘H
      ['⌥⌘H', inCanvas, 'history.open'],
      ['⇧⌘A', inCanvas, null],
      ['⌘,', inCanvas, 'settings.open'], // P8-B2 delta: CONTRACT §1 / §2 global keys answer with the canvas focused
      ['?', inCanvas, 'help.shortcuts'], // P8-B2 delta (the forwarder skips it in a text field)
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
  test('a fromCanvas action is a shell action with a ⌘ chord (or F6, or ?) the canvas resolves', () => {
    for (const a of ACTIONS.filter((x) => x.fromCanvas)) {
      expect(a.exec).toBe('shell');
      const live = (a.keys ?? []).filter((b) => bindingInDocument(b, 'canvas'));
      expect(live.length).toBeGreaterThan(0);
      // S2.21: F6 / ⇧F6 (`ui.cycle-region`) are a bare-key forward; P8-B2: so is "?" (`help.shortcuts`)
      for (const b of live) expect(b.chord.includes('⌘') || /^(⇧?F6|\?)$/.test(b.chord)).toBe(true);
    }
  });
  test('k() is the only chord source the defs use (no raw, un-normalised strings)', () => {
    expect(k('⌘ ⇧ G')).toBe('⇧⌘G');
  });
});
