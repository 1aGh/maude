// #168 F5 — the Light/Dark pill's path button. The pill used to copy `window.__canvas_meta_file__`, a global any
// canvas code can overwrite, so a click on "Copy relative path" could put a planted string on the clipboard. The
// pill now only asks (`copy-canvas-path`, an active-gated c2s row with no payload); the shell copies the path it
// holds for the active tab (the `canvas.copy-file-path` action), and a background frame's ask is refused.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

const STUDIO = join(import.meta.dir, '..');

describe('the pill asks, it never copies', () => {
  let root: { unmount(): void } | null = null;
  // Unmount inside act: React 19 schedules the commit's passive-effect flush on the scheduler, and an unmount
  // outside act leaves that task to fire after `afterAll` removed the happy-dom window (`window is not defined`,
  // an unhandled error between tests that fails the CI shard).
  afterEach(async () => {
    const { act } = await import('react');
    await act(async () => {
      root?.unmount();
    });
    root = null;
    document.body.innerHTML = '';
  });

  test('a click posts copy-canvas-path to the shell and writes nothing to the clipboard', async () => {
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { CanvasThemePill } = await import('../canvas-theme-pill.tsx');
    (window as unknown as { __canvas_meta_file__: string }).__canvas_meta_file__ =
      'planted: rm -rf ~';
    const posted: unknown[] = [];
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: (m: unknown) => posted.push(m) },
    });
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t: string) => void written.push(t) },
    });
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    const host = document.createElement('div');
    document.body.append(host);
    const r = createRoot(host);
    root = r;
    act(() => r.render(<CanvasThemePill bothThemes={() => true} />));
    const btn = document.querySelector<HTMLButtonElement>('[data-testid="canvas-theme-path"]');
    expect(btn).not.toBeNull();
    await act(async () => {
      btn?.click();
      await new Promise((res) => setTimeout(res, 10));
    });
    expect(posted).toEqual([{ dgn: 'copy-canvas-path' }]);
    expect(written).toEqual([]);
  });
});

describe('the row and its handler', () => {
  test('copy-canvas-path is an active-gated c2s row with no payload; a background frame is refused', async () => {
    const { acceptFromCanvas, C2S_ACTIVE, DGN_TABLE } = await import('../bridge/dgn-protocol.ts');
    const row = (DGN_TABLE.c2s as Record<string, { gate: string; status: string }>)[
      'copy-canvas-path'
    ];
    expect(row?.gate).toBe('active');
    expect(row?.status).toBe('live');
    expect(C2S_ACTIVE.has('copy-canvas-path')).toBe(true);
    const origin = 'http://canvas.test';
    const active = { name: 'a' } as unknown as Window;
    const background = { name: 'b' } as unknown as Window;
    const ev = (source: unknown) =>
      ({ data: { dgn: 'copy-canvas-path', path: '/etc/passwd' }, source, origin }) as MessageEvent;
    expect(acceptFromCanvas(ev(active), { canvasOrigin: origin, active })).toEqual({
      dgn: 'copy-canvas-path',
    });
    expect(acceptFromCanvas(ev(background), { canvasOrigin: origin, active })).toBeNull();
  });

  test('the bridge copies the path the shell holds (canvas.copy-file-path), never one from the message', () => {
    const bridge = readFileSync(join(STUDIO, 'client/hooks/use-canvas-bridge.jsx'), 'utf8');
    const i = bridge.indexOf("m.dgn === 'copy-canvas-path'");
    expect(i).toBeGreaterThan(0);
    // after the up-front C2S_ACTIVE check, so only the active frame reaches it
    expect(i).toBeGreaterThan(bridge.indexOf('if (C2S_ACTIVE.has(m.dgn))'));
    const branch = bridge.slice(i, i + 400);
    expect(branch).toContain("menuRunner.run('canvas.copy-file-path')");
    expect(branch).not.toMatch(/m\.path|m\.file/);
    const pill = readFileSync(join(STUDIO, 'canvas-theme-pill.tsx'), 'utf8');
    expect(pill).not.toContain('clipboard');
  });
});
