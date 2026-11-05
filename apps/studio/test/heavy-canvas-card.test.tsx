// 2.0.5 — the too-heavy card: what it says and that its two doors call back.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

describe('TooHeavyCanvas', () => {
  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
  });
  afterAll(() => GlobalRegistrator.unregister());

  test('names the problem and offers the lighter way in', async () => {
    const { TooHeavyCanvas } = await import('../client/v2/shell/too-heavy-card.jsx');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const got: string[] = [];
    await act(async () => {
      root.render(
        <TooHeavyCanvas
          name="mascot-exploration"
          onLight={() => got.push('light')}
          onAll={() => got.push('all')}
        />
      );
    });
    const card = host.querySelector('[data-testid="canvas-too-heavy"]');
    expect(card?.textContent).toContain('This canvas is too heavy to show all at once.');
    expect(card?.textContent).toContain('mascot-exploration');
    const light = host.querySelector<HTMLButtonElement>('[data-testid="canvas-too-heavy-light"]');
    expect(light?.textContent).toBe('Show visible artboards only');
    await act(async () => light?.click());
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[data-testid="canvas-too-heavy-all"]')?.click()
    );
    expect(got).toEqual(['light', 'all']);
    await act(async () => root.unmount());
    host.remove();
  });

  test('the light choice reaches the frame URL; a capture never takes it', async () => {
    const { canvasUrl } = await import('../client/canvas-url.js');
    const light = new URL(canvasUrl('.design/a.tsx', {}, { light: true }), 'http://x');
    expect(light.searchParams.get('artboard-live')).toBe('light');
    const plain = new URL(canvasUrl('.design/a.tsx', {}, undefined), 'http://x');
    expect(plain.searchParams.has('artboard-live')).toBe(false);
  });
});
