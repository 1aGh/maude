import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PhotoKnobs } from '../client/photo-knobs.jsx';

let host: HTMLDivElement;
let root: Root;
let originalFetch: typeof fetch;
let writes: unknown[];
let previews: unknown[];
let history: unknown[][];

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());
beforeEach(() => {
  writes = [];
  previews = [];
  history = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url, init) => {
    if (init?.method === 'PUT') writes.push(JSON.parse(String(init.body)));
    return new Response('{}');
  }) as typeof fetch;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      createElement(PhotoKnobs, {
        asset: 'assets/abcdef12.png',
        initialEdit: { adjustments: { brightness: 0.25 }, grain: { amount: 0.1 } },
        onEdit: (edit: unknown) => previews.push(edit),
        onRecordEdit: (before: unknown, after: unknown) => history.push([before, after]),
      })
    )
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  globalThis.fetch = originalFetch;
});

for (const ordering of ['click-before-blur', 'blur-before-click']) {
  test(`reset survives ${ordering} and persists neutral adjustments`, async () => {
    const contrast = host.querySelector<HTMLInputElement>('input[aria-label="Contrast"]')!;
    const reset = host.querySelector<HTMLButtonElement>(
      '[aria-label="reset Adjustments section"]'
    )!;
    act(() => contrast.focus());
    // Native WebDriver emits click before moving focus; Chromium emits blur
    // first. Both events may run before React commits the next render.
    act(() => {
      if (ordering === 'click-before-blur') {
        reset.click();
        contrast.blur();
      } else {
        contrast.blur();
        reset.click();
      }
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 220));
    });
    expect(previews.at(-1)).toEqual({ grain: { amount: 0.1 } });
    expect(writes).toEqual([{ grain: { amount: 0.1 } }]);
    // A follow-up commit must use the result of reset as its history base.
    if (ordering === 'click-before-blur')
      expect(history.at(-1)?.[0]).toEqual({ grain: { amount: 0.1 } });
  });
}
