// P8 round 7 (13 · ds-edit-colour, ds-edge-contrast): a swatch (or a component master) selected on the Design
// system canvas is THAT element — a ring on the swatch — never the section's artboard. The board's tokens carry no
// data-cd-id (the board draws them), so the selection names them by their own attribute, scoped to the section, and
// carries no artboard: nothing that treats "no id + an artboard" as a whole-artboard pick (the eight handles + size
// tag, Delete = delete the artboard, ⌘C = copy the artboard) reaches it.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { hoverTargetToSelection, resolveSelectionEl } from '../dom-selection.ts';
import type { HoverTarget } from '../input-router.tsx';

function board(): void {
  document.body.innerHTML = `
    <article data-dc-screen="ds-colour"><div class="dc-artboard-body"><div class="ds ds-board">
      <span class="ds-sw" data-ds-token="--fg-0" data-ds-label="Fg 0"><i class="ds-chip"></i><b>Fg 0</b></span>
      <span class="ds-sw" data-ds-token="--accent" data-ds-label="Accent"><i class="ds-chip"></i><b>Accent</b></span>
    </div></div></article>
    <article data-dc-screen="ds-components"><div class="dc-artboard-body">
      <div class="ds-m" data-ds-master="Button" data-ds-label="Button"><button>Buy</button></div>
    </div></article>`;
}
const sel = (el: Element, artboardId: string | null) =>
  hoverTargetToSelection({ el, cdId: null, artboardId } as HoverTarget);

describe('a Design system token or master is selected as itself', () => {
  test('the swatch: scoped by its token, no artboard, resolves back to the swatch', () => {
    board();
    const sw = document.querySelector('[data-ds-token="--accent"]') as Element;
    const s = sel(sw, 'ds-colour');
    expect(s.selector).toBe('[data-dc-screen="ds-colour"] [data-ds-token="--accent"]');
    expect(s.artboardId).toBeNull();
    expect(s.id).toBeUndefined();
    expect(resolveSelectionEl(document, s)).toBe(sw);
  });

  test('a component master the same way', () => {
    board();
    const m = document.querySelector('[data-ds-master="Button"]') as Element;
    const s = sel(m, 'ds-components');
    expect(s.selector).toBe('[data-dc-screen="ds-components"] [data-ds-master="Button"]');
    expect(s.artboardId).toBeNull();
    expect(resolveSelectionEl(document, s)).toBe(m);
  });

  test('the artboard itself (its chrome, its empty page) is still the whole artboard', () => {
    board();
    const art = document.querySelector('[data-dc-screen="ds-colour"]') as Element;
    const s = sel(art, 'ds-colour');
    expect(s.selector).toBe('[data-dc-screen="ds-colour"]');
    expect(s.artboardId).toBe('ds-colour');
  });
});
