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
