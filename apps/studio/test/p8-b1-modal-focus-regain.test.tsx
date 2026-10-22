// P8 bug sweep B1 — "Menu › Diagnostics › Logs opens the sheet but esc does not close it".
// Opened from the Menu with the pointer resting where the row was, closing the menu uncovers the canvas iframe;
// its pointerenter pulls the keyboard into the canvas a few ms after the sheet took it, so esc/Tab go to the canvas.
// useModalFocus now takes the keyboard back from an iframe that grabbed it in the first moments.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useModalFocus } from '../client/v2/shell/modal-focus.js';

let roots: Root[] = [];
afterEach(() => {
  act(() => {
    for (const r of roots) r.unmount();
  });
  roots = [];
  document.body.innerHTML = '';
});

function Sheet({ onClose }: { onClose: () => void }) {
  const ref = useModalFocus({ onClose, modal: false });
  return (
    <section ref={ref as never} tabIndex={-1} data-testid="sheet">
      <button type="button">inside</button>
    </section>
  );
}

function mountWithCanvas() {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const host = document.createElement('div');
  document.body.append(host);
  const r = createRoot(host);
  roots.push(r);
  act(() => r.render(<Sheet onClose={() => {}} />));
  return { frame, sheet: host.querySelector('[data-testid="sheet"]') as HTMLElement };
}
const wait = (ms: number) => act(async () => new Promise((res) => setTimeout(res, ms)));

describe('P8 B1 — an overlay keeps the keyboard a canvas grabs right after it opens', () => {
  test('the canvas takes focus 13 ms after the sheet did: the sheet gets it back', async () => {
    const { frame, sheet } = mountWithCanvas();
    expect(document.activeElement).toBe(sheet);
    frame.focus(); // canvas-lib's pointerenter auto-focus, from the pointer resting under the closed menu
    await wait(20);
    expect(document.activeElement).toBe(sheet);
  });

  test('a canvas focus long after opening is the person’s own click: left alone', async () => {
    const { frame, sheet } = mountWithCanvas();
    expect(document.activeElement).toBe(sheet);
    await wait(650);
    frame.focus();
    await wait(20);
    expect(document.activeElement).toBe(frame);
  });
});
