// P8 c6 (14 ed-ab-resize) — the two modifier hints beside the resize pill are TWO pills, one per key (the board's
// `.ed-hint`), not one box with a dot between them.
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PresetRuler, type RulerHud } from '../editing/preset-ruler.tsx';

const hud = (presetsOff: boolean): RulerHud => ({
  ghost: { left: 0, top: 0, width: 100, height: 80 },
  rect: { left: 0, top: 0, width: 90, height: 80 },
  box: { w: 1280, h: 1052 },
  preset: { label: 'Laptop', w: 1280 },
  stops: [],
  pointer: { x: 200, y: 200 },
  edge: 'e',
  presetsOff,
});

describe('the resize hints', () => {
  test('one pill per key', () => {
    const html = renderToStaticMarkup(<PresetRuler hud={hud(false)} />);
    const pills = html.match(/class="ed-ab-hint"/g) ?? [];
    expect(pills.length).toBe(2);
    expect(html).toContain('<kbd>⌘</kbd> ignores presets');
    expect(html).toContain('<kbd>⌥</kbd> from the centre');
    expect(html).not.toContain('ignores presets · ');
  });

  test('⌘ held: one pill says presets are off', () => {
    const html = renderToStaticMarkup(<PresetRuler hud={hud(true)} />);
    expect(html).toContain('Presets are off');
    expect((html.match(/class="ed-ab-hint"/g) ?? []).length).toBe(1);
  });
});
