// V2-1.2 §7 T3 — the accept helpers apply origin, gate and payload in one place.
// acceptFromCanvas refuses a wrong origin and a non-active source for `active` messages (never
// `null === null`) and accepts the asked frame; acceptFromShell refuses a sibling frame for
// `parent` messages and accepts self only for `parent|self`.

import { describe, expect, test } from 'bun:test';
import {
  acceptFromCanvas,
  acceptFromShell,
  C2S_ACTIVE,
  canvasGateOk,
  canvasMayHandle,
  DGN_TABLE,
  shellGateOk,
} from '../bridge/dgn-protocol.ts';

const ORIGIN = 'http://canvas.test';
const active = { name: 'active' } as unknown as Window;
const background = { name: 'background' } as unknown as Window;
const asked = { name: 'asked' } as unknown as Window;
const ev = (data: unknown, source: unknown, origin = ORIGIN) =>
  ({ data, source, origin }) as unknown as MessageEvent;
const ctx = { canvasOrigin: ORIGIN, active, asked, frames: () => [active, background, asked] };

describe('acceptFromCanvas (shell side)', () => {
  test('an active-gated message: only from the active canvas window', () => {
    const msg = { dgn: 'delete-request', id: 'h', idIndex: 0, extra: 1 };
    expect(acceptFromCanvas(ev(msg, active), ctx)).toEqual({
      dgn: 'delete-request',
      id: 'h',
      idIndex: 0,
    });
    expect(acceptFromCanvas(ev(msg, background), ctx)).toBeNull();
    expect(acceptFromCanvas(ev(msg, null), ctx)).toBeNull();
    expect(acceptFromCanvas(ev(msg, null), { ...ctx, active: null })).toBeNull(); // not null === null
    expect(acceptFromCanvas(ev(msg, active, 'http://evil.example'), ctx)).toBeNull();
  });

  test('asked: only the frame the shell asked', () => {
    const msg = { dgn: 'export-capture-done', id: 'x1', items: [] };
    expect(acceptFromCanvas(ev(msg, asked), ctx)).not.toBeNull();
    expect(acceptFromCanvas(ev(msg, active), ctx)).toBeNull();
    expect(acceptFromCanvas(ev(msg, asked), { ...ctx, asked: null })).toBeNull();
  });

  test('frame: any iframe the shell owns; any: any canvas-origin window', () => {
    expect(acceptFromCanvas(ev({ dgn: 'canvas-expired' }, background), ctx)).not.toBeNull();
    expect(acceptFromCanvas(ev({ dgn: 'canvas-expired' }, { name: 'stranger' }), ctx)).toBeNull();
    expect(acceptFromCanvas(ev({ dgn: 'loaded', file: 'a.tsx' }, background), ctx)).not.toBeNull();
  });

  test('a shell→canvas type, an unknown type or a malformed payload is refused', () => {
    expect(acceptFromCanvas(ev({ dgn: 'tool-set', tool: 'hand' }, active), ctx)).toBeNull();
    expect(acceptFromCanvas(ev({ dgn: 'toString' }, active), ctx)).toBeNull();
    expect(acceptFromCanvas(ev({ dgn: 'delete-request' }, active), ctx)).toBeNull();
    expect(acceptFromCanvas(ev('delete-request', active), ctx)).toBeNull();
  });

  test('C2S_ACTIVE is the table’s active set (the shell’s up-front check)', () => {
    for (const t of [
      'comment-compose',
      'layers-tree',
      'open-inspector',
      'comment-click',
      'tool-cursor',
      'artboards',
      'export-history-request',
      'select-set',
      'apply-edit',
      'key',
    ])
      expect(C2S_ACTIVE.has(t), t).toBe(true);
    for (const t of [
      'loaded',
      'canvas-expired',
      'export-capture-done',
      'export-selection',
      'tool-set',
    ])
      expect(C2S_ACTIVE.has(t), t).toBe(false);
  });
});

describe('acceptFromShell (canvas side)', () => {
  const win = { parent: { name: 'shell' } } as unknown as Window;
  const shell = (win as unknown as { parent: unknown }).parent;
  const sibling = { name: 'sibling' };

  test('a parent-gated message: only from window.parent', () => {
    const msg = { dgn: 'tool-set', tool: 'hand' };
    expect(acceptFromShell(ev(msg, shell), win)).toEqual(msg);
    expect(acceptFromShell(ev(msg, sibling), win)).toBeNull();
    expect(acceptFromShell(ev(msg, null), win)).toBeNull();
    expect(acceptFromShell(ev(msg, win), win)).toBeNull(); // self is not the parent
  });

  test('parent|self also accepts the canvas document itself (the comment composer)', () => {
    expect(canvasGateOk('parent|self', ev({}, win), win)).toBe(true);
    expect(canvasGateOk('parent|self', ev({}, shell), win)).toBe(true);
    expect(canvasGateOk('parent|self', ev({}, sibling), win)).toBe(false);
    expect(canvasGateOk('parent', ev({}, win), win)).toBe(false);
  });

  test('canvasMayHandle: the table gate for its own types, no opinion on the rest', () => {
    expect(canvasMayHandle(ev({ dgn: 'select-by-id', id: 'h' }, sibling), win)).toBe(false);
    expect(canvasMayHandle(ev({ dgn: 'select-by-id', id: 'h' }, shell), win)).toBe(true);
    expect(canvasMayHandle(ev({ dgn: 'theme', theme: 'dark' }, sibling), win)).toBe(true); // gate any today (→ parent in V2-2.10c)
    expect(canvasMayHandle(ev({ dgn: 'not-ours' }, sibling), win)).toBe(true);
    expect(canvasMayHandle(ev(null, sibling), win)).toBe(true);
  });

  test('the S1 rows are parent-gated in the table', () => {
    for (const t of ['tool-set', 'locked-set', 'select-by-id', 'run-action'] as const)
      expect(DGN_TABLE.s2c[t].gate, t).toBe('parent');
  });

  test('shellGateOk never lets null pass as the active window', () => {
    expect(shellGateOk('active', ev({}, null), { canvasOrigin: ORIGIN, active: null })).toBe(false);
    expect(
      shellGateOk('asked', ev({}, undefined), { canvasOrigin: ORIGIN, active, asked: undefined })
    ).toBe(false);
  });
});

describe('convert-marks (V2-8.5 c7, 08 ak-convert-after)', () => {
  const shell = { name: 'shell' } as unknown as Window;
  const sibling = { name: 'sibling' } as unknown as Window;
  const win = { parent: shell } as unknown as Window;
  const msg = { dgn: 'convert-marks', v: 1, from: 'post', to: 'a6', extraPct: 13, fill: 'Ink' };

  test('is a shell→canvas, parent-gated row', () => {
    expect(DGN_TABLE.s2c['convert-marks'].gate).toBe('parent');
    expect(Object.keys(DGN_TABLE.c2s)).not.toContain('convert-marks');
  });

  test('only the parent frame is heard; a sibling or the canvas itself is refused', () => {
    expect(acceptFromShell(ev(msg, shell), win)).toEqual(msg);
    expect(acceptFromShell(ev(msg, sibling), win)).toBeNull();
    expect(acceptFromShell(ev(msg, win), win)).toBeNull();
  });

  test('the payload is checked: ids are strings, the percent a number, the fill a short word or null', () => {
    const ok = (o: Record<string, unknown>) => acceptFromShell(ev({ ...msg, ...o }, shell), win);
    expect(ok({ fill: null })).not.toBeNull();
    expect(ok({ extraPct: 'a lot' })).toBeNull();
    expect(ok({ from: 4 })).toBeNull();
    expect(ok({ fill: 'x'.repeat(41) })).toBeNull();
    expect(ok({ v: 2 })).toBeNull();
    expect(acceptFromShell(ev({ dgn: 'convert-marks', v: 1 }, shell), win)).toBeNull();
  });
});

describe('ai-copies (V2-8.5 c7, 03 ai-copy)', () => {
  const shell = { name: 'shell' } as unknown as Window;
  const sibling = { name: 'sibling' } as unknown as Window;
  const win = { parent: shell } as unknown as Window;
  const msg = { dgn: 'ai-copies', v: 1, copies: [{ from: 'post', to: 'post-copy-a1b2c3' }] };

  test('is a shell to canvas, parent-gated row', () => {
    expect(DGN_TABLE.s2c['ai-copies'].gate).toBe('parent');
    expect(Object.keys(DGN_TABLE.c2s)).not.toContain('ai-copies');
  });

  test('only the parent frame is heard; a sibling or the canvas itself is refused', () => {
    expect(acceptFromShell(ev(msg, shell), win)).toEqual(msg);
    expect(acceptFromShell(ev(msg, sibling), win)).toBeNull();
    expect(acceptFromShell(ev(msg, win), win)).toBeNull();
  });

  test('ids only: an id outside the artboard grammar, a missing id or too many pairs are refused whole', () => {
    const ok = (o: Record<string, unknown>) => acceptFromShell(ev({ ...msg, ...o }, shell), win);
    expect(ok({ copies: [] })).not.toBeNull();
    expect(ok({ copies: [{ from: 'post', to: 'x y' }] })).toBeNull();
    expect(ok({ copies: [{ from: 'post', to: 4 }] })).toBeNull();
    expect(ok({ copies: [{ from: 'post' }] })).toBeNull();
    expect(
      ok({ copies: Array.from({ length: 21 }, (_, i) => ({ from: 'a', to: `b${i}` })) })
    ).toBeNull();
    expect(ok({ v: 2 })).toBeNull();
    // a caption the shell might be tempted to send never survives the parser (the busy chat's title stays home)
    const words = ok({ copies: [{ from: 'post', to: 'copy', caption: 'before Make it greener' }] });
    expect(JSON.stringify(words)).not.toContain('Make it greener');
  });
});

describe('viewport-zoom fit flag (V2-8.5 c7, 01 cf-open-big "Zoom to fit · N %")', () => {
  const base = { dgn: 'viewport-zoom', zoom: 0.1 };

  test('the camera says it is fitted: an optional boolean rides on the existing message', () => {
    expect(acceptFromCanvas(ev({ ...base, fit: true }, active), ctx)).toEqual({
      ...base,
      fit: true,
    });
    expect(acceptFromCanvas(ev(base, active), ctx)).toEqual(base); // older canvases: no flag
  });

  test('a flag that is not a boolean refuses the whole message', () => {
    expect(acceptFromCanvas(ev({ ...base, fit: 'yes' }, active), ctx)).toBeNull();
    expect(acceptFromCanvas(ev({ ...base, fit: 1 }, active), ctx)).toBeNull();
  });

  test('still active-gated: a background canvas cannot move the readout', () => {
    expect(acceptFromCanvas(ev({ ...base, fit: true }, background), ctx)).toBeNull();
  });
});

describe('shell-panels (V2-8.5 c7, 15 an-stk-gallery / 04 md-edit-image)', () => {
  const shell = { name: 'shell' } as unknown as Window;
  const sibling = { name: 'sibling' } as unknown as Window;
  const win = { parent: shell } as unknown as Window;
  const msg = { dgn: 'shell-panels', v: 1, open: 'stickers' };

  test('is a shell→canvas, parent-gated row', () => {
    expect(DGN_TABLE.s2c['shell-panels'].gate).toBe('parent');
    expect(Object.keys(DGN_TABLE.c2s)).not.toContain('shell-panels');
  });

  test('only the parent frame is heard; a sibling or the canvas itself is refused', () => {
    expect(acceptFromShell(ev(msg, shell), win)).toEqual(msg);
    expect(acceptFromShell(ev(msg, sibling), win)).toBeNull();
    expect(acceptFromShell(ev(msg, win), win)).toBeNull();
  });

  test('open is an enum (stickers · assets · null) and nothing else', () => {
    const ok = (o: Record<string, unknown>) => acceptFromShell(ev({ ...msg, ...o }, shell), win);
    expect(ok({ open: 'assets' })).not.toBeNull();
    expect(ok({ open: null })).not.toBeNull();
    expect(ok({ open: 'templates' })).toBeNull();
    expect(ok({ open: '<img src=x>' })).toBeNull();
    expect(ok({ open: undefined })).toBeNull();
    expect(ok({ v: 2 })).toBeNull();
    expect(acceptFromShell(ev({ dgn: 'shell-panels', v: 1 }, shell), win)).toBeNull();
  });
});
