// p8-sweep-leftovers item 3 (confirm): Assets › "All kinds ▾" › Photos is not dead.
//
// The crawler called `assets-kinds-image` DEAD on a project whose assets are all pictures: the filter then hides
// nothing, and the only visible change is the chip's own label ("All kinds" → "Photos") plus the menu closing,
// which its noise floor cannot tell from Esc. The pick does set the filter.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let KindsChip: typeof import('../client/v2/assets/kinds-chip.jsx').KindsChip;
let root: Root | null = null;
beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  ({ KindsChip } = await import('../client/v2/assets/kinds-chip.jsx'));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});
afterAll(() => GlobalRegistrator.unregister());

describe('Assets kinds › Photos', () => {
  test('picks the image filter, relabels the chip and closes the menu', async () => {
    const picked: string[] = [];
    function Host() {
      const [v, setV] = useState('all');
      return createElement(KindsChip, {
        value: v,
        onChange: (k: string) => {
          picked.push(k);
          setV(k);
        },
      });
    }
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(createElement(Host)));
    const chip = host.querySelector('[data-testid="assets-kinds"]') as HTMLButtonElement;
    const before = chip.textContent;
    await act(async () => chip.click());
    await act(async () =>
      (host.querySelector('[data-testid="assets-kinds-image"]') as HTMLElement).click()
    );
    expect(picked).toEqual(['image']);
    expect(chip.textContent).not.toBe(before);
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });
});
