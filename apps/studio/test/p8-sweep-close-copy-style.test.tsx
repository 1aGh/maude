// p8-sweep-close (2) — Copy style / Paste style say what happened (the dynamic sweep found
// `adv-copy-style` DEAD: it filled a ref and drew nothing, so the person could not tell a copy from a
// miss). Through the real useCanvasBridge hook and real `message` events (harness as s2-22).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 500)); // Sonner's exit timers
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { dismissNotice, NotificationHost } from '../notifications.tsx';

const CANVAS_ORIGIN = 'http://canvas.test';
const FILE = '.design/ui/Site.tsx';
const win = { name: 'active', postMessage: () => {} };
const held: { current: unknown } = { current: null };
const writes: Array<Record<string, unknown>> = [];
const NativeFetch = globalThis.fetch;

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(async () => {
  await act(async () => {
    dismissNotice('copy-style');
    await new Promise((r) => setTimeout(r, 350));
  });
  act(() => root?.unmount());
  host?.remove();
  root = null;
  writes.length = 0;
  globalThis.fetch = NativeFetch;
});

function props() {
  const values: Record<string, unknown> = {
    selected: held.current,
    layersTree: null,
    cfg: { canvasOrigin: CANVAS_ORIGIN, designRel: '.design' },
    viewerMode: false,
    commentsByFile: {},
    theme: 'light',
    activePath: FILE,
    iframesRef: { current: new Map([[FILE, { contentWindow: win }]]) },
    selectedRef: held,
  };
  const cache = new Map<string, unknown>();
  return new Proxy(values, {
    get(target, key) {
      if (typeof key !== 'string') return undefined;
      if (key in target) return target[key];
      if (!cache.has(key)) cache.set(key, key.endsWith('Ref') ? { current: null } : () => {});
      return cache.get(key);
    },
  });
}

async function mount() {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    writes.push({ url, body: JSON.parse(String(init?.body || '{}')) });
    return new Response('{"ok":true}', { status: 200 });
  }) as unknown as typeof fetch;
  const { useCanvasBridge } = await import('../client/hooks/use-canvas-bridge.jsx');
  function Harness() {
    useCanvasBridge(props() as never);
    return <NotificationHost />;
  }
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(<Harness />));
}

function post(data: unknown) {
  const ev = new Event('message');
  Object.defineProperties(ev, {
    data: { value: data },
    origin: { value: CANVAS_ORIGIN },
    source: { value: win },
  });
  act(() => {
    window.dispatchEvent(ev);
  });
}
const text = async () => {
  await act(async () => new Promise((r) => setTimeout(r, 50)));
  return [...document.querySelectorAll('.maude-notice')].map((n) => n.textContent).join(' | ');
};
const el = (id: string, authored: Record<string, string>) => ({
  file: FILE,
  id,
  selector: `[data-cd-id="${id}"]`,
  artboardId: 'a1',
  tag: 'h1',
  authored,
});

describe('Copy style gives visible feedback', () => {
  test('a copy with a style of its own says how much it copied', async () => {
    held.current = el('aaaaaaaa', { color: 'red', 'font-size': '32px', width: '100px' });
    await mount();
    post({ dgn: 'copy-style' });
    expect(await text()).toContain('Style copied — 2 properties.');
  });

  test('an object whose look comes only from its classes says nothing was copied', async () => {
    held.current = el('aaaaaaaa', { width: '100px' });
    await mount();
    post({ dgn: 'copy-style' });
    expect(await text()).toContain('Nothing copied');
  });

  test('Paste style before any copy says so; after a copy it writes the style', async () => {
    held.current = el('bbbbbbbb', {});
    await mount();
    post({ dgn: 'paste-style', id: 'bbbbbbbb' });
    expect(await text()).toContain('Nothing to paste yet');
    expect(writes.length).toBe(0);
    held.current = el('aaaaaaaa', { color: 'red' });
    post({ dgn: 'copy-style' });
    post({ dgn: 'paste-style', id: 'bbbbbbbb' });
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(writes.map((w) => w.body)).toEqual([
      { canvas: FILE, id: 'bbbbbbbb', property: 'color', value: 'red' },
    ]);
  });
});
