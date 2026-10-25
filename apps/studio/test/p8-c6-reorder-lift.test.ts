// P8 c6 (14 ed-lay-reorder) — the card that is dragged to reorder is LIFTED: tilted, a touch larger, ringed in the
// accent, with a deep shadow — and the slot it leaves is the CARD's size, not the tilted bounds.
import { describe, expect, test } from 'bun:test';
import { cardBox, LIFT, liftCard, slotRect } from '../editing/reorder-slot.tsx';

describe('the lifted card', () => {
  test('liftCard tilts and scales through the individual properties, never `transform`', () => {
    const style: Record<string, string> = { transform: 'translate(10px, 4px)', opacity: '0.5' };
    liftCard({ style } as unknown as HTMLElement);
    expect(style.rotate).toBe('-2deg');
    expect(style.scale).toBe('1.03');
    expect(style.boxShadow).toContain('0 0 0 1.5px');
    expect(style.opacity).toBe('1');
    // the drag's own translate is untouched (translateOf / slotRect read it)
    expect(style.transform).toBe('translate(10px, 4px)');
    expect(LIFT.rotate).toBe('-2deg');
  });

  test('the slot is the card size about the same centre, with the translate taken off', () => {
    // a 400 × 232 card at zoom 2 whose tilted bounds are bigger than the card
    const bounds = { left: 480, top: 280, width: 830, height: 520 };
    const card = cardBox(bounds, 400, 232, 2);
    expect(card).toEqual({ left: 495, top: 308, width: 800, height: 464 });
    expect(slotRect(card, 'translate(100px, -20px)', 2)).toEqual({
      left: 295,
      top: 348,
      width: 800,
      height: 464,
    });
  });

  test('the drag lifts the card it floats', async () => {
    const src = await Bun.file(new URL('../canvas-shell.tsx', import.meta.url)).text();
    expect(src).toContain('liftCard(d.el)');
    expect(src).not.toContain("d.el.style.opacity = '0.9'");
  });
});
