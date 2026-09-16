// Two synced photo edits in a row leave the NEWER one on screen.
//
// Each synced edit makes the photo bridge re-fetch the sidecar. The answers
// can arrive out of order, and the bridge applied whichever came last — the
// older edit went back on screen while every disk had the newer one (surface
// run 2026-09-16, L13 on the hub: the change was shown, then reverted).
//
// Observed through the bake: applying a non-default edit schedules one, and
// in this DOM (no WebGL) that bake fails loudly. A stale answer that is
// correctly ignored schedules nothing.

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { PhotoPreviewBridge } from '../canvas-lib.tsx';

const ASSET = 'assets/0a1b2c3d.png';

test('an older sidecar answer arriving last does not replace the newer one', async () => {
  const img = document.createElement('img');
  img.setAttribute('src', `/.design/${ASSET}`);
  document.body.append(img);
  const host = document.createElement('div');
  document.body.append(host);

  // Every fetch waits for the test to answer it.
  const answers: Array<(body: unknown) => void> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    new Promise((resolve) => {
      answers.push((body) =>
        resolve(
          new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
        )
      );
    })) as unknown as typeof fetch;
  const errors: unknown[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => errors.push(args[0]);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<PhotoPreviewBridge />));
    // The mount-time hydration asks once; answer it with "no edit".
    await act(async () => {
      for (const a of answers.splice(0)) a({});
    });
    const refreshed = () =>
      document.dispatchEvent(
        new CustomEvent('maude:photo-edit-refreshed', { detail: { sha8: '0a1b2c3d' } })
      );
    await act(async () => {
      refreshed(); // an edit
      refreshed(); // then a reset of it
    });
    expect(answers.length).toBe(2);
    const [older, newer] = answers.splice(0);
    await act(async () => {
      newer?.({}); // the reset lands first
    });
    await act(async () => {
      older?.({ adjustments: { brightness: 0.4 } }); // the edit it replaced lands last
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200)); // past the bake debounce
    });
    expect(errors.filter((e) => String(e).includes('bake failed'))).toEqual([]);
    expect(img.getAttribute('src')).toBe(`/.design/${ASSET}`);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = realFetch;
    console.error = realError;
    img.remove();
    host.remove();
  }
});
