// P8 C7 (14 ed-ab-tidy): an artboard a marquee catches is selected with the SAME snapshot a click makes — its
// attrs and world size — so the multi-artboard card can say a shared size or "Mixed" instead of "—".
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

describe('artboardHit', () => {
  test('carries the board’s attrs + world size + selector, not just its id', async () => {
    const { artboardHit } = await import('../artboard-marquee.tsx');
    document.body.innerHTML =
      '<article data-dc-screen="p4" data-dc-kind="digital" data-dc-bg="paper" style="width:1080px;height:1350px"></article>';
    const el = document.querySelector('[data-dc-screen="p4"]') as HTMLElement;
    const sel = artboardHit(el, 'p4') as unknown as Record<string, unknown>;
    expect(sel.selector).toBe('[data-dc-screen="p4"]');
    expect(sel.artboardId).toBe('p4');
    expect((sel.attrs as Record<string, string>)['data-dc-kind']).toBe('digital');
    expect((sel.attrs as Record<string, string>)['data-dc-bg']).toBe('paper');
    expect(sel.id).toBeUndefined();
    expect('worldW' in sel).toBe(true);
  });
});
