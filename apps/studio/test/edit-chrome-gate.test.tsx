// P8 C5 — Edit chrome is hidden in Preview (04 R1: md-preview, md-annotate, md-comment, md-draw, md-inspect,
// md-edge-ai drew the selection rim, the "div · 1440 × 900" tag, the size tag, tab badges and the rotate handle in
// Preview), and leaving Edit drops the Edit selection (the handoff never did).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CanvasModeV2 } from '../bridge/canvas-modes.ts';
import {
  EditChromeGate,
  editChromeShown,
  useDropSelectionOnLeaveEdit,
} from '../editing/edit-chrome-gate.tsx';

describe('editChromeShown', () => {
  test('governed: Edit only — Preview, Viewing and Present draw none of it', () => {
    expect(editChromeShown('edit', 'edit')).toBe(true);
    for (const m of ['preview', 'viewing', 'present'] as const)
      expect(editChromeShown(m, 'edit')).toBe(false);
  });
  test('ungoverned keeps v1: the posture decides; an embed never draws it', () => {
    expect(editChromeShown(null, 'edit')).toBe(true);
    expect(editChromeShown(null, null)).toBe(true);
    expect(editChromeShown(null, 'preview')).toBe(false);
    expect(editChromeShown('edit', 'edit', true)).toBe(false);
  });
});

describe('EditChromeGate', () => {
  test('hides without unmounting (listeners stay)', () => {
    expect(
      renderToStaticMarkup(
        <EditChromeGate shown={false}>
          <i id="x" />
        </EditChromeGate>
      )
    ).toContain('display:none');
    expect(
      renderToStaticMarkup(
        <EditChromeGate shown={false}>
          <i id="x" />
        </EditChromeGate>
      )
    ).toContain('id="x"');
    expect(
      renderToStaticMarkup(
        <EditChromeGate shown>
          <i />
        </EditChromeGate>
      )
    ).toContain('display:contents');
  });
});

describe('useDropSelectionOnLeaveEdit', () => {
  test('edit → preview clears once; preview → edit and preview → preview do not', () => {
    let clears = 0;
    let set: (m: CanvasModeV2 | null) => void = () => {};
    function H() {
      const [m, setM] = (require('react') as typeof import('react')).useState<CanvasModeV2 | null>(
        'edit'
      );
      set = setM;
      useDropSelectionOnLeaveEdit(m, () => clears++);
      return null;
    }
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(<H />));
    expect(clears).toBe(0);
    act(() => set('preview'));
    expect(clears).toBe(1);
    act(() => set('preview'));
    act(() => set('edit'));
    expect(clears).toBe(1);
    act(() => set('viewing'));
    expect(clears).toBe(2);
    act(() => root.unmount());
  });
});

describe('EditingLayer wires the gate', () => {
  const src = readFileSync(join(import.meta.dir, '../editing/index.tsx'), 'utf8');
  test('the object chrome sits inside <EditChromeGate>; the handoff hook runs', () => {
    const open = src.indexOf('<EditChromeGate');
    const close = src.indexOf('</EditChromeGate>');
    expect(open).toBeGreaterThan(0);
    const inside = src.slice(open, close);
    for (const c of [
      '<EditingSelection',
      '<SizeGhost',
      '<KeyboardBadges',
      '<RotateHandle',
      '<CornerDots',
      '<ArtboardHandles',
      '<GapBands',
      '<AlignBar',
    ])
      expect({ c, inside: inside.includes(c) }).toEqual({ c, inside: true });
    expect(src).toContain('useDropSelectionOnLeaveEdit(');
  });
});
