// T2.5 (#163) — the "Previewing <canvas> · ⌥⌘P to edit" bar shows only when there is a Back to go to (a link was
// followed in Preview). A plain switch to Preview changes only the toolbar: no bar.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ALL_CAPS } from '../bridge/canvas-modes.ts';
import { PreviewChrome } from '../client/v2/preview/preview-chrome-host.jsx';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});
async function mount(el: unknown) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(el as never));
}
const q = (sel: string) => host?.querySelector(sel) ?? null;

describe('the Previewing bar', () => {
  test('a plain Preview (no Back) draws no bar', async () => {
    await mount(<PreviewChrome mode="preview" caps={ALL_CAPS} name="Pricing" zoom={1} />);
    expect(q('[data-testid="preview-bar"]')).toBeNull();
  });
  test('after a followed link it shows, with the way back', async () => {
    let backs = 0;
    await mount(
      <PreviewChrome
        mode="preview"
        caps={ALL_CAPS}
        name="Pricing"
        zoom={1}
        back="Homepage"
        onBack={() => backs++}
      />
    );
    expect(q('[data-testid="preview-bar"]')).not.toBeNull();
    expect(q('[data-testid="preview-bar-title"]')?.textContent).toContain('Pricing');
    act(() => (q('[data-testid="preview-bar-back"]') as HTMLButtonElement).click());
    expect(backs).toBe(1);
  });
});
