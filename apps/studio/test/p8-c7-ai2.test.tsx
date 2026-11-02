// P8 stage C round 7 (p8-c7-ai2) — 03 AI Chat: what the board draws that the first c7 pass left open.
//   - the point ring's chip reads the spot's own size on a print artboard ("9 pt"), not its humanised id
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

let registeredHere = false;
beforeAll(async () => {
  if (typeof document === 'undefined') {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    GlobalRegistrator.register();
    registeredHere = true;
  }
});
afterAll(async () => {
  if (registeredHere && GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { pointChipText } from '../editing/ai-point-ring.tsx';

describe('pointChipText — the chip on the ring an answered question leaves (03 ai-question "9 pt")', () => {
  const mount = (kind: string, inner: string) => {
    document.body.innerHTML = `<div data-dc-screen="poster" data-dc-kind="${kind}">${inner}</div>`;
    return document.querySelector('[data-cd-id="date-line"]') as HTMLElement;
  };

  test('a text spot on a print artboard says its size in points', () => {
    const el = mount(
      'print',
      '<div data-cd-id="date-line" style="font-size: 12px">So 14. 3. · Kraví hora</div>'
    );
    expect(pointChipText(el, 'Date line')).toBe('9 pt');
  });

  test('a digital artboard keeps the spot’s name (points are print’s unit)', () => {
    const el = mount(
      'digital',
      '<div data-cd-id="date-line" style="font-size: 12px">So 14. 3. · Kraví hora</div>'
    );
    expect(pointChipText(el, 'Date line')).toBe('Date line');
  });

  test('a spot with no text of its own keeps its name', () => {
    const el = mount('print', '<div data-cd-id="date-line" style="font-size: 12px"></div>');
    expect(pointChipText(el, 'Date line')).toBe('Date line');
  });

  test('no element found (the artboard is off screen): the name stands', () => {
    expect(pointChipText(null, 'Date line')).toBe('Date line');
  });
});
