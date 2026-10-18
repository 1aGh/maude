// S1.14 — looking at a past version (V2-1.9 §5.6, S1-slices contract note 6, Q10): the shell's mode store
// HOLDS `viewing{at}` against a canvas's mode-requests, esc returns, the historical canvas is read-only
// (no tools, no AI, no locks) and never writes its camera or layout back (the S1.11 risk note).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof document === 'undefined') GlobalRegistrator.register();
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { ALL_CAPS, NO_CAPS } from '../bridge/canvas-modes.ts';
import { canvasUrl } from '../client/canvas-url.js';
import {
  capsFor,
  createShellMode,
  decideModeRequest,
  heldMode,
} from '../client/v2/shell/canvas-mode.js';
import { type ClassifyInput, classify } from '../input-router.tsx';
import { isHistoricalCanvas, persistsCanvasMeta } from '../read-only-mode.ts';

const EDITOR = capsFor({ canEdit: true });
const VIEW = {
  path: '.design/ui/Uniformy-2027.tsx',
  at: 'r41',
  title: 'Schváleno trenéry',
  when: '5 Oct, 18:40',
  who: 'Jonas',
};
const ctx = (over = {}) => ({
  caps: EDITOR,
  presenting: false,
  mode: 'edit',
  modalOpen: false,
  viewing: null,
  ...over,
});

describe('the mode store holds viewing{at}', () => {
  test('view() keeps the version, the mode the person was in, and leaveViewing() goes back to it', () => {
    const s = createShellMode(ALL_CAPS);
    s.select('preview');
    expect(s.get().viewing).toBeNull();
    s.view(VIEW);
    expect(s.get().viewing).toMatchObject({ at: 'r41', path: VIEW.path, who: 'Jonas' });
    expect(s.get().mode).toBe('preview'); // the held mode is not rewritten: leaving restores it
    expect(s.leaveViewing()).toBe(true);
    expect(s.get().viewing).toBeNull();
    expect(s.get().mode).toBe('preview');
    expect(s.leaveViewing()).toBe(false);
  });

  test('while viewing, a switch click, a mode and Present change nothing', () => {
    const s = createShellMode(ALL_CAPS);
    s.view(VIEW);
    const nonce = s.get().nonce;
    s.select('preview');
    expect(s.get().mode).toBe('edit');
    expect(s.present({ kind: 'canvas' })).toBe(false);
    expect(s.get().mode).toBe('edit');
    expect(s.get().nonce).toBe(nonce);
  });

  test('viewing another version replaces the first; an invalid ref is refused', () => {
    const s = createShellMode(ALL_CAPS);
    s.view(VIEW);
    s.view({ ...VIEW, at: 'r30', title: 'Číslo 27 větší' });
    expect(s.get().viewing.at).toBe('r30');
    expect(() => s.view({ ...VIEW, at: 'now' })).not.toThrow();
    expect(s.get().viewing.at).toBe('r30'); // only r<n> and git:<sha> are versions
  });

  test('the canvases are told Viewing with no capabilities, whatever the role', () => {
    const s = createShellMode(ALL_CAPS);
    expect(heldMode(s.get(), 'edit', EDITOR)).toEqual({ mode: 'edit', caps: EDITOR });
    s.view(VIEW);
    expect(heldMode(s.get(), 'edit', EDITOR)).toEqual({ mode: 'viewing', caps: NO_CAPS });
    expect(heldMode(s.get(), 'preview', EDITOR).caps).toEqual(NO_CAPS);
  });
});

describe('a canvas mode-request is held while viewing (note 6)', () => {
  const held = ctx({ viewing: VIEW });
  test('esc (`back`) returns to now; every other request is denied, silently', () => {
    expect(decideModeRequest({ mode: 'back', cause: 'esc' }, held)).toEqual({
      kind: 'exit-viewing',
    });
    for (const req of [
      { mode: 'preview', cause: 'key' },
      { mode: 'edit', tool: 'move', cause: 'key' },
      { mode: 'present', present: { kind: 'canvas' }, cause: 'key' },
      { mode: 'edit', tool: 'sticky', cause: 'key' },
    ])
      expect(decideModeRequest(req, held)).toEqual({ kind: 'deny', reason: 'viewing' });
  });
  test('not viewing: the M4 decisions are what they were', () => {
    expect(decideModeRequest({ mode: 'preview', cause: 'key' }, ctx())).toEqual({
      kind: 'set',
      mode: 'preview',
    });
    expect(decideModeRequest({ mode: 'back', cause: 'esc' }, ctx())).toBeNull();
  });
});

describe('the framed past version (canvasUrl)', () => {
  const cfg = { designRel: '.design' };
  test('?sha= + read-only + no comment layer, and the canvas knows to hold still', () => {
    const u = new URL(canvasUrl('.design/ui/Uniformy-2027.tsx', cfg, { viewing: 'r41' }), 'http://x');
    expect(u.searchParams.get('sha')).toBe('r41');
    expect(u.searchParams.get('ro')).toBe('1');
    expect(u.searchParams.get('comments')).toBe('0');
    expect(u.searchParams.get('hide-chrome')).toBeNull(); // the bar is the shell's; the canvas keeps its own camera tools
  });
  test('DiffView keeps its `sha` option untouched (clean pane, no ro)', () => {
    const u = new URL(
      canvasUrl('.design/ui/Uniformy-2027.tsx', cfg, { sha: 'abc123', hideChrome: true }),
      'http://x'
    );
    expect(u.searchParams.get('sha')).toBe('abc123');
    expect(u.searchParams.get('ro')).toBeNull();
  });
});

describe('inside a `?sha=` canvas: nothing is written back, esc asks for now', () => {
  const at = (qs: string) =>
    (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(
      `http://localhost:4399/_canvas-shell.html${qs}`
    );
  test('isHistoricalCanvas reads the URL; the camera and layout lanes are not persisted', () => {
    at('?canvas=ui%2FUniformy-2027.tsx');
    expect(isHistoricalCanvas()).toBe(false);
    expect(persistsCanvasMeta()).toBe(true);
    at('?canvas=ui%2FUniformy-2027.tsx&sha=r41');
    expect(isHistoricalCanvas()).toBe(true);
    expect(persistsCanvasMeta()).toBe(false);
    at('?canvas=ui%2FUniformy-2027.tsx&sha=');
    expect(isHistoricalCanvas()).toBe(false);
  });
  test('esc is a mode-request `back` even at a resting Viewing tool', () => {
    const esc: ClassifyInput = {
      type: 'keydown',
      key: 'Escape',
      mode: 'viewing',
      activeTool: 'move',
    } as ClassifyInput;
    at('?canvas=x&sha=r41');
    expect(classify(esc)).toEqual({ kind: 'escape', back: true });
    at('?canvas=x');
    expect(classify(esc)).toEqual({ kind: 'escape' });
  });
  test('the canvas-lib persists nothing through the same guard', async () => {
    const src = await Bun.file(new URL('../canvas-lib.tsx', import.meta.url)).text();
    const body = src.slice(src.indexOf('function patchCanvasMeta'));
    expect(body.slice(0, body.indexOf('const file = readCanvasMetaFile()'))).toContain(
      'persistsCanvasMeta()'
    );
  });
});
