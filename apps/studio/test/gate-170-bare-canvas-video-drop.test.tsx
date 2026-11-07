// #170 — a video dropped on bare canvas (outside every artboard) goes to the host's `onMedia` (AnnotationsLayer's
// media-reference chip), the same loose placement a bare-canvas photo gets from `onImage`. The old upload + toasted
// `<Video>` snippet is only the fallback for a host that gives no `onMedia`.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { type MediaDropCallbacks, useCanvasMediaDrop } from '../use-canvas-media-drop.tsx';

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

function Host({ callbacks }: { callbacks: MediaDropCallbacks }) {
  useCanvasMediaDrop({ enabled: true, screenToWorld: (x, y) => [x, y], callbacks });
  return null;
}

function dropFiles(files: File[]) {
  const ev = new window.Event('drop', { bubbles: true, cancelable: true }) as unknown as DragEvent;
  Object.defineProperty(ev, 'dataTransfer', {
    value: { files, types: ['Files'], getData: () => '' },
  });
  Object.defineProperty(ev, 'clientX', { value: 40 });
  Object.defineProperty(ev, 'clientY', { value: 60 });
  act(() => {
    document.dispatchEvent(ev);
  });
  return ev;
}

describe('a video dropped on bare canvas', () => {
  test('goes to the host’s onMedia at the drop point, not to the upload-and-snippet fallback', () => {
    const calls: Array<[string, string, [number, number]]> = [];
    const fetched: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((u: string) => {
      fetched.push(String(u));
      return Promise.resolve(new Response('{}', { status: 500 }));
    }) as unknown as typeof fetch;
    try {
      root = createRoot(document.createElement('div'));
      act(() =>
        root?.render(
          <Host
            callbacks={{
              onImage: () => {},
              onLink: () => {},
              onMedia: (f, kind, world) => calls.push([f.name, kind, world]),
            }}
          />
        )
      );
      const ev = dropFiles([new File(['x'], 'clip.mp4', { type: 'video/mp4' })]);
      expect(calls).toEqual([['clip.mp4', 'video', [40, 60]]]);
      expect(ev.defaultPrevented).toBe(true);
      expect(fetched).toEqual([]); // the hook itself uploaded nothing
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
