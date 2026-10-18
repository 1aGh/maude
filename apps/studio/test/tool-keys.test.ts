// V2-4.5b — the toolbar keys (V2-1.2 §5.4–5.5 T8, §9 Q1/Q2/Q4; V2-1.3 §5.5, invariant 2):
//  · toolKeyAction per mode and role — own keys arm, crossings ask the shell, the role gets a denial;
//  · the esc ladder (escStep): tool → rest → the previous mode;
//  · the registry: every v2 tool key resolves per mode, every rule-13 v1 key is unbound everywhere;
//  · input-router's governed classify: a crossing is exactly one `mode-request`, never a `tool`;
//  · the shell's half: decideModeRequest refuses by role, ⌥⌘P toggles.
import { describe, expect, test } from 'bun:test';

import { canvasKeyCtx } from '../actions/ctx.ts';
import { documentIndex } from '../actions/documents.ts';
import { MOVED_KEYS } from '../actions/help.ts';
import { ACTIONS } from '../actions/index.ts';
import { k } from '../actions/keys.ts';
import { resolveChord } from '../actions/resolve.ts';
import type { KeyCtx, Mode } from '../actions/types.ts';
import {
  ALL_CAPS,
  type CanvasModeV2,
  escStep,
  homeModeOfTool,
  type ModeCaps,
  modeKeys,
  NO_CAPS,
  slotAllows,
  toolKeyAction,
} from '../bridge/canvas-modes.ts';
import { capsFor, decideModeRequest, previewToggleTarget } from '../client/v2/shell/canvas-mode.js';
import { type ClassifyInput, classify } from '../input-router.tsx';

const EDITOR: ModeCaps = ALL_CAPS;
const COMMENTER: ModeCaps = capsFor({ canEdit: false, role: 'viewer' });
const VIEWER: ModeCaps = NO_CAPS;

describe('toolKeyAction (T8)', () => {
  const act = (mode: CanvasModeV2, key: string, caps: ModeCaps = EDITOR, tip?: 'highlighter') =>
    toolKeyAction(mode, k(key), caps, tip);

  test("Edit's own keys: V H arm, F R arm their drag tools (S2.13), I adds one, T arms click-to-type (S2.12), P ⇧I wait for S2", () => {
    expect(act('edit', 'V')).toEqual({ kind: 'arm', tool: 'move' });
    expect(act('edit', 'H')).toEqual({ kind: 'arm', tool: 'hand' });
    expect(act('edit', 'F')).toEqual({ kind: 'arm', tool: 'frame' });
    expect(act('edit', 'R')).toEqual({ kind: 'arm', tool: 'el-shape' });
    expect(act('edit', 'T')).toEqual({ kind: 'arm', tool: 'el-text' });
    expect(act('edit', 'I')).toEqual({ kind: 'insert', insert: 'image' });
    for (const key of ['P', '⇧I', 'O']) expect(act('edit', key)).toBeNull();
  });

  test('Edit: N C M A E S switch to Preview with that tool (E opens Stickers; M its last tip, Q4)', () => {
    expect(act('edit', 'N')).toEqual({ kind: 'request', mode: 'preview', tool: 'sticky' });
    expect(act('edit', 'C')).toEqual({ kind: 'request', mode: 'preview', tool: 'comment' });
    expect(act('edit', 'M')).toEqual({ kind: 'request', mode: 'preview', tool: 'pen' });
    expect(act('edit', 'M', EDITOR, 'highlighter')).toEqual({
      kind: 'request',
      mode: 'preview',
      tool: 'highlighter',
    });
    expect(act('edit', 'A')).toEqual({ kind: 'request', mode: 'preview', tool: 'arrow' });
    expect(act('edit', 'E')).toEqual({ kind: 'request', mode: 'preview', panel: 'stickers' });
    expect(act('edit', 'S')).toEqual({ kind: 'request', mode: 'preview', tool: 'section' });
  });

  test("Preview's own keys: H R T stay (annotation Hand / Shape / Text), E opens the panel", () => {
    expect(act('preview', 'H')).toEqual({ kind: 'arm', tool: 'browse' });
    expect(act('preview', 'R')).toEqual({ kind: 'arm', tool: 'shape' });
    expect(act('preview', 'T')).toEqual({ kind: 'arm', tool: 'text' });
    expect(act('preview', 'N')).toEqual({ kind: 'arm', tool: 'sticky' });
    expect(act('preview', 'M', EDITOR, 'highlighter')).toEqual({
      kind: 'arm',
      tool: 'highlighter',
    });
    expect(act('preview', 'E')).toEqual({ kind: 'panel', panel: 'stickers' });
  });

  test('Q2 — Preview: V F I switch to Edit (P ⇧I wait for S2); a momentary slot arms nothing', () => {
    expect(act('preview', 'V')).toEqual({ kind: 'request', mode: 'edit', tool: 'move' });
    expect(act('preview', 'F')).toEqual({ kind: 'request', mode: 'edit', tool: 'frame' });
    expect(act('preview', 'I')).toEqual({ kind: 'request', mode: 'edit' });
    expect(act('preview', 'P')).toBeNull();
    expect(act('preview', '⇧I')).toBeNull();
  });

  test('Viewing: H inspects, C comments; every editing key reaches the denial line', () => {
    expect(act('viewing', 'H', COMMENTER)).toEqual({ kind: 'arm', tool: 'inspect' });
    expect(act('viewing', 'C', COMMENTER)).toEqual({ kind: 'arm', tool: 'comment' });
    expect(act('viewing', 'N', COMMENTER)).toEqual({
      kind: 'deny',
      mode: 'preview',
      tool: 'sticky',
    });
    expect(act('viewing', 'V', COMMENTER)).toEqual({ kind: 'deny', mode: 'edit', tool: 'move' });
    expect(act('viewing', 'F', COMMENTER)).toEqual({ kind: 'deny', mode: 'edit', tool: 'frame' });
    expect(act('viewing', 'E', COMMENTER)).toEqual({
      kind: 'deny',
      mode: 'preview',
      panel: 'stickers',
    });
    // Can view: not even Comment
    expect(act('viewing', 'C', VIEWER)).toEqual({ kind: 'deny', mode: 'viewing', tool: 'comment' });
  });

  test('a viewing role in Preview: Hand and Comment work, the rest is the denial line (Q2)', () => {
    expect(act('preview', 'H', COMMENTER)).toEqual({ kind: 'arm', tool: 'browse' });
    expect(act('preview', 'C', COMMENTER)).toEqual({ kind: 'arm', tool: 'comment' });
    expect(act('preview', 'N', COMMENTER)).toEqual({
      kind: 'deny',
      mode: 'preview',
      tool: 'sticky',
    });
    expect(act('preview', 'V', COMMENTER)).toEqual({ kind: 'deny', mode: 'edit', tool: 'move' });
  });

  test('Present answers no tool key (L is S3’s pointer)', () => {
    for (const key of ['V', 'H', 'N', 'C', 'M', 'E', 'S']) expect(act('present', key)).toBeNull();
  });

  test('modeKeys lists exactly what each mode answers', () => {
    expect(modeKeys('edit')).toEqual(['V', 'H', 'F', 'R', 'T', 'I', 'N', 'C', 'M', 'A', 'E', 'S']);
    expect(modeKeys('preview')).toEqual([
      'H',
      'N',
      'C',
      'M',
      'A',
      'R',
      'T',
      'E',
      'S',
      'V',
      'F',
      'I',
    ]);
    expect(modeKeys('viewing')).toEqual([
      'H',
      'C',
      'N',
      'M',
      'A',
      'R',
      'T',
      'E',
      'S',
      'V',
      'F',
      'I',
    ]);
    expect(modeKeys('present')).toEqual(['L']); // S3.2b: the presenter's Pointer, nothing else
  });
});

describe('homeModeOfTool / slotAllows', () => {
  test('annotation tools are Preview’s, Select is Edit’s (Viewing’s for a viewing role), Hand no one’s', () => {
    expect(homeModeOfTool('pen', EDITOR, 'edit')).toBe('preview');
    expect(homeModeOfTool('eraser', EDITOR, 'edit')).toBe('preview');
    expect(homeModeOfTool('comment', EDITOR, 'edit')).toBe('preview');
    expect(homeModeOfTool('comment', COMMENTER, 'viewing')).toBe('viewing');
    expect(homeModeOfTool('move', EDITOR, 'preview')).toBe('edit');
    expect(homeModeOfTool('move', COMMENTER, 'preview')).toBe('viewing');
    expect(homeModeOfTool('move', COMMENTER, 'viewing')).toBe('viewing'); // Viewing's Hand rides it
    expect(homeModeOfTool('browse', EDITOR, 'edit')).toBe('preview');
    expect(homeModeOfTool('frame', EDITOR, 'preview')).toBe('edit');
    expect(homeModeOfTool('hand', EDITOR, 'preview')).toBeNull();
    expect(homeModeOfTool('nope', EDITOR, 'edit')).toBeNull();
  });
  test('slotAllows: a slot’s minRole', () => {
    expect(slotAllows('preview', 'sticky', EDITOR)).toBe(true);
    expect(slotAllows('preview', 'sticky', COMMENTER)).toBe(false);
    expect(slotAllows('preview', 'eraser', COMMENTER)).toBe(false); // a Marker tip
    expect(slotAllows('preview', 'comment', COMMENTER)).toBe(true);
    expect(slotAllows('preview', 'comment', VIEWER)).toBe(false);
    expect(slotAllows('preview', 'browse', VIEWER)).toBe(true);
  });
});

describe('escStep (04 md-esc)', () => {
  const rows: [CanvasModeV2, string, string][] = [
    ['edit', 'hand', 'rest'],
    ['edit', 'move', 'stay'],
    ['preview', 'pen', 'rest'],
    ['preview', 'sticky', 'rest'],
    ['preview', 'browse', 'back'], // two steps when N C M A E S brought you here
    ['viewing', 'comment', 'rest'],
    ['viewing', 'inspect', 'stay'], // "there's no Edit to return to" (S3.11: Viewing rests on inspect)
    ['present', 'browse', 'back'],
  ];
  for (const [mode, tool, want] of rows)
    test(`${mode} · ${tool} → ${want}`, () => expect(escStep(mode, tool)).toBe(want));
});

// ── the registry ──────────────────────────────────────────────────────────────────────────────

const CANVAS = documentIndex(
  ACTIONS,
  'canvas',
  (id) => id.startsWith('tool.') && id !== 'tool.hand-hold'
);
const ctxIn = (mode: Mode, readOnly = false): KeyCtx =>
  canvasKeyCtx({ typing: false, readOnly, mode });

describe('registry: the toolbar keys per mode (rule 13)', () => {
  test('every key a mode answers resolves to one tool action there, from the canvas', () => {
    for (const mode of ['edit', 'preview', 'viewing'] as const)
      for (const key of modeKeys(mode)) {
        const r = resolveChord(CANVAS, k(key), ctxIn(mode));
        expect(`${mode} ${key} ${r?.action.id.startsWith('tool.') ?? false}`).toBe(
          `${mode} ${key} true`
        );
        expect(r?.ambiguous ?? []).toEqual([]);
      }
  });

  test('a key resolves in exactly the modes that answer it (Present answers only L, no pending key)', () => {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    for (const mode of ['edit', 'preview', 'viewing', 'present'] as const)
      for (const l of [...letters, ...letters.map((x) => `⇧${x}`)]) {
        const r = resolveChord(CANVAS, k(l), ctxIn(mode));
        const want = modeKeys(mode).includes(l);
        expect(`${mode} ${l} ${!!r}`).toBe(`${mode} ${l} ${want}`);
      }
  });

  test('every rule-13 v1 key is unbound in every mode, and listed as moved', () => {
    const dead: [string, string][] = [
      ['B', 'tool.pen'],
      ['O', 'tool.ellipse'],
      ['⇧S', 'tool.section'],
    ];
    for (const mode of ['edit', 'preview', 'viewing', 'present'] as const)
      for (const [key] of dead) expect(resolveChord(CANVAS, k(key), ctxIn(mode))).toBeNull();
    // I and E kept a key — with a new owner (Image, Stickers), never the old tool
    for (const mode of ['edit', 'preview', 'viewing'] as const) {
      expect(resolveChord(CANVAS, k('I'), ctxIn(mode))?.action.id).toBe('tool.image');
      expect(resolveChord(CANVAS, k('E'), ctxIn(mode))?.action.id).toBe('tool.stickers');
    }
    const keysOf = (id: string) => ACTIONS.find((a) => a.id === id)?.keys ?? [];
    expect(keysOf('tool.highlighter')).toEqual([]);
    expect(keysOf('tool.eraser')).toEqual([]);
    expect(ACTIONS.some((a) => a.id === 'export.canvas-dialog')).toBe(false); // D3: ⌘E unbound, S8.2: retired
    for (const [key, to] of [...dead, ['I', 'tool.highlighter'], ['E', 'tool.eraser']])
      expect(MOVED_KEYS.some((m) => m.to === to && m.was.endsWith(key))).toBe(true);
  });

  test('⌘E is bound to nothing, anywhere; ⇧⌘E is the one export sheet', () => {
    const owners = (c: string) =>
      ACTIONS.filter((a) => (a.keys ?? []).some((b) => b.chord === k(c))).map((a) => a.id);
    expect(owners('⌘E')).toEqual([]);
    expect(owners('⇧⌘E')).toEqual(['export.open']);
    expect(owners('⇧⌘A')).toEqual(['select.all']); // v1's ⇧-alias of ⌘A (defect 1); Assistant left
    expect(owners('⌘/')).toEqual(['ai.chat']);
  });
});

// ── input-router, governed ───────────────────────────────────────────────────────────────────

const key = (k0: string, extra: Partial<ClassifyInput>) =>
  classify({ type: 'keydown', key: k0, activeTool: 'move', ...extra } as ClassifyInput);
const gov = (mode: CanvasModeV2, caps: ModeCaps = EDITOR) => ({ mode, caps });

describe('input-router: governed keys (M3)', () => {
  test('Edit: a crossing is one mode-request with the tool, never a local tool', () => {
    expect(key('n', gov('edit'))).toEqual({
      kind: 'mode-request',
      mode: 'preview',
      tool: 'sticky',
      cause: 'key',
    });
    expect(key('m', { ...gov('edit'), markerTip: 'eraser' })).toEqual({
      kind: 'mode-request',
      mode: 'preview',
      tool: 'eraser',
      cause: 'key',
    });
    expect(key('e', gov('edit'))).toEqual({
      kind: 'mode-request',
      mode: 'preview',
      panel: 'stickers',
      cause: 'key',
    });
    expect(key('v', gov('edit'))).toEqual({ kind: 'tool', tool: 'move' });
  });

  test('Preview: own keys arm locally, V asks for Edit', () => {
    const p = { ...gov('preview'), activeTool: 'browse' as const };
    expect(key('n', p)).toEqual({ kind: 'tool', tool: 'sticky' });
    expect(key('h', p)).toEqual({ kind: 'tool', tool: 'browse' });
    expect(key('v', p)).toEqual({ kind: 'mode-request', mode: 'edit', tool: 'move', cause: 'key' });
  });

  test('Viewing: H arms `inspect` (S3.11: a tool of its own); N asks — the shell denies', () => {
    const v = gov('viewing', COMMENTER);
    expect(key('h', v)).toEqual({ kind: 'tool', tool: 'inspect' });
    expect(key('c', v)).toEqual({ kind: 'tool', tool: 'comment' });
    expect(key('n', v)).toEqual({
      kind: 'mode-request',
      mode: 'preview',
      tool: 'sticky',
      cause: 'key',
    });
    expect(key('e', v)).toEqual({ kind: 'panel', panel: 'stickers' }); // the shell refuses it
  });

  test('esc: Preview at rest and Present step back; anything else is the local ladder', () => {
    expect(key('Escape', { ...gov('preview'), activeTool: 'browse' })).toEqual({
      kind: 'escape',
      back: true,
    });
    expect(key('Escape', { ...gov('preview'), activeTool: 'pen' })).toEqual({ kind: 'escape' });
    expect(key('Escape', { ...gov('present'), activeTool: 'browse' })).toEqual({
      kind: 'escape',
      back: true,
    });
    expect(key('Escape', gov('edit'))).toEqual({ kind: 'escape' });
    expect(key('Escape', { activeTool: 'browse' })).toEqual({ kind: 'escape' }); // ungoverned: v1
  });

  test('Q1 — ⌥⌘P: Preview → back, else → Preview; not in Present', () => {
    const opt = { altKey: true, metaKey: true, code: 'KeyP' };
    expect(key('π', { ...opt, ...gov('edit') })).toEqual({
      kind: 'mode-request',
      mode: 'preview',
      cause: 'key',
    });
    expect(key('π', { ...opt, ...gov('preview'), activeTool: 'pen' })).toEqual({
      kind: 'mode-request',
      mode: 'back',
      cause: 'key',
    });
    expect(key('π', { ...opt, ...gov('present') }).kind).toBe('no-op');
  });

  test('typing in a text field: no tool key', () => {
    expect(key('n', { ...gov('edit'), isEditable: true }).kind).toBe('no-op');
  });
});

describe('shell: decideModeRequest refuses by role (Q2); ⌥⌘P toggles (Q1)', () => {
  const base = { presenting: false, modalOpen: false };
  test('a viewing role asking for an annotation tool gets the denial line, comment it may', () => {
    const ctx = { ...base, caps: COMMENTER, mode: 'viewing' };
    expect(decideModeRequest({ mode: 'preview', tool: 'sticky', cause: 'key' }, ctx)).toEqual({
      kind: 'deny',
      reason: 'role',
    });
    expect(decideModeRequest({ mode: 'preview', tool: 'eraser', cause: 'key' }, ctx)).toEqual({
      kind: 'deny',
      reason: 'role',
    });
    expect(decideModeRequest({ mode: 'edit', tool: 'move', cause: 'key' }, ctx)).toEqual({
      kind: 'deny',
      reason: 'role',
    });
    expect(decideModeRequest({ mode: 'preview', tool: 'comment', cause: 'key' }, ctx)).toEqual({
      kind: 'set',
      mode: 'preview',
      tool: 'comment',
    });
    expect(
      decideModeRequest(
        { mode: 'preview', tool: 'comment', cause: 'key' },
        { ...ctx, caps: VIEWER }
      )
    ).toEqual({ kind: 'deny', reason: 'role' });
  });
  test('an editor crossing gets the mode and the tool', () => {
    expect(
      decideModeRequest(
        { mode: 'preview', tool: 'sticky', cause: 'key' },
        { ...base, caps: EDITOR, mode: 'edit' }
      )
    ).toEqual({ kind: 'set', mode: 'preview', tool: 'sticky' });
  });
  test('previewToggleTarget', () => {
    expect(previewToggleTarget('edit', EDITOR)).toBe('preview');
    expect(previewToggleTarget('preview', EDITOR)).toBe('edit');
    expect(previewToggleTarget('preview', COMMENTER)).toBe('viewing');
    expect(previewToggleTarget('viewing', COMMENTER)).toBe('preview');
  });
});
