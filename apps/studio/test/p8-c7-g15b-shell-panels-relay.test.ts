// P8 c7 g15b - the shell side of `shell-panels`: tells each canvas frame which tool panel is up, once per change,
// and again to a frame that has just loaded.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createShellPanelsLane, openPanel } from '../client/v2/shell/shell-panels-relay.js';

function frame() {
  const sent: unknown[] = [];
  const contentWindow = { postMessage: (m: unknown) => sent.push(m) };
  return { sent, f: { contentWindow } };
}

describe('shell-panels relay', () => {
  test('Stickers wins over Assets; neither is null', () => {
    expect(openPanel({ stickers: true, assets: true })).toBe('stickers');
    expect(openPanel({ stickers: false, assets: true })).toBe('assets');
    expect(openPanel({ stickers: false, assets: false })).toBeNull();
  });

  test('tells the frame on a change, not on a repeat, and says null when it closes', () => {
    const a = frame();
    const lane = createShellPanelsLane({ frames: () => [a.f as never] });
    lane.set(null); // nothing to say to a frame that never heard anything
    expect(a.sent).toEqual([]);
    lane.set('stickers');
    lane.set('stickers');
    lane.set(null);
    expect(a.sent).toEqual([
      { dgn: 'shell-panels', v: 1, open: 'stickers' },
      { dgn: 'shell-panels', v: 1, open: null },
    ]);
  });

  test('a frame that has just loaded hears the standing answer again; a stranger does not trigger it', () => {
    const a = frame();
    const lane = createShellPanelsLane({ frames: () => [a.f as never] });
    lane.set('assets');
    expect(a.sent.length).toBe(1);
    lane.onMessage({ data: { dgn: 'loaded' }, source: {} } as never);
    expect(a.sent.length).toBe(1);
    lane.onMessage({ data: { dgn: 'loaded' }, source: a.f.contentWindow } as never);
    expect(a.sent.at(-1)).toEqual({ dgn: 'shell-panels', v: 1, open: 'assets' });
    expect(a.sent.length).toBe(2);
  });

  test('app.jsx mounts it with the gallery request and the Assets panel state', () => {
    const src = readFileSync(join(import.meta.dir, '../client/app.jsx'), 'utf8');
    expect(src).toContain('useShellPanelsRelay({');
    expect(src).toContain('componentsOpen: !!componentsReq');
  });
});
