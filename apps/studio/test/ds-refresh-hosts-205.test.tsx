// 2.0.5 (#205) — the shell's design-system hosts read on events, not on a clock. On a cell an open DS board sent
// ~50 requests a minute (make-state, system-files, check-system, ds/state, off-system) and kept the hub's studio
// child at 1.5 GB / 138 % CPU. Pinned here, through the real hosts with a fast `pollMs`:
//   - make-state, system-files, check-system and off-system are read once, then only when the shell wrote the
//     system (DS_STATE_CHANGED) — never between events, whatever the old poll rate said;
//   - ds/state (the "changed outside" card) keeps ONE slow clock, held while the canvas is broken or loading.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const DS_STATE_CHANGED = 'maude:ds-state-changed';
const CFG = {
  designRel: '.design',
  designSystems: [{ name: 'studio', label: 'Studio', path: 'system/studio' }],
  dsConverted: { studio: true },
  canvasOrigin: 'http://canvas.test',
};
const DS_CANVAS = '.design/system/studio/design-system.tsx';

const roots: Root[] = [];
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

async function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return host;
}
const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));

function counter() {
  const seen: string[] = [];
  const impl = (async (url: string) => {
    seen.push(String(url).replace(/\?.*$/, ''));
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, count: (path: string) => seen.filter((u) => u === path).length };
}

describe('no reads between events', () => {
  test('make-state', async () => {
    const { DsMakeHost } = await import('../client/v2/ds/make-host.jsx');
    const Host = DsMakeHost as unknown as (p: Record<string, unknown>) => React.ReactElement;
    const c = counter();
    await mount(
      <Host cfg={CFG} activePath={DS_CANVAS} fetchImpl={c.impl} pollMs={10} frameFor={() => null} />
    );
    await wait(120);
    expect(c.count('/_api/ds/make-state')).toBe(1);
    await act(async () => void window.dispatchEvent(new Event(DS_STATE_CHANGED)));
    await wait(20);
    expect(c.count('/_api/ds/make-state')).toBe(2);
  });

  test('system-files and check-system', async () => {
    const { DsAdvancedHost } = await import('../client/v2/ds/advanced-host.jsx');
    const Host = DsAdvancedHost as unknown as (p: Record<string, unknown>) => React.ReactElement;
    const c = counter();
    await mount(<Host cfg={CFG} activePath={DS_CANVAS} fetchImpl={c.impl} pollMs={10} />);
    await wait(120);
    expect(c.count('/_api/ds/system-files')).toBe(1);
    expect(c.count('/_api/ds/check-system')).toBe(1);
    await act(async () => void window.dispatchEvent(new Event(DS_STATE_CHANGED)));
    await wait(20);
    expect(c.count('/_api/ds/system-files')).toBe(2);
    expect(c.count('/_api/ds/check-system')).toBe(2);
  });

  test('off-system', async () => {
    const { DsOffSystemHost } = await import('../client/v2/ds/off-system-host.jsx');
    const Host = DsOffSystemHost as unknown as (p: Record<string, unknown>) => React.ReactElement;
    const c = counter();
    await mount(
      <Host
        cfg={CFG}
        activePath=".design/ui/Pricing.tsx"
        fetchImpl={c.impl}
        pollMs={10}
        firstMs={0}
      />
    );
    await wait(120);
    expect(c.count('/_api/ds/off-system')).toBe(1);
    await act(async () => void window.dispatchEvent(new Event(DS_STATE_CHANGED)));
    await wait(20);
    expect(c.count('/_api/ds/off-system')).toBe(2);
  });
});

describe('the one slow read (ds/state)', () => {
  test('held while the canvas is broken, running again once it has drawn', async () => {
    const { DsTruthHost } = await import('../client/v2/ds/truth-host.jsx');
    const Host = DsTruthHost as unknown as (p: Record<string, unknown>) => React.ReactElement;
    const pane = document.createElement('main');
    pane.className = 'viewport sh-stage';
    pane.setAttribute('data-canvas-state', 'error');
    document.body.append(pane);
    const c = counter();
    await mount(
      <Host cfg={CFG} activePath={DS_CANVAS} fetchImpl={c.impl} pollMs={15} frameFor={() => null} />
    );
    await wait(120);
    expect(c.count('/_api/ds/state')).toBe(1);
    pane.setAttribute('data-canvas-state', 'loading');
    await wait(60);
    expect(c.count('/_api/ds/state')).toBe(1);
    pane.setAttribute('data-canvas-state', 'ready');
    await wait(80);
    expect(c.count('/_api/ds/state')).toBeGreaterThan(1);
  });

  test('held while the window is hidden; read again when it is looked at', async () => {
    const { DsTruthHost } = await import('../client/v2/ds/truth-host.jsx');
    const Host = DsTruthHost as unknown as (p: Record<string, unknown>) => React.ReactElement;
    const c = counter();
    await mount(
      <Host cfg={CFG} activePath={DS_CANVAS} fetchImpl={c.impl} pollMs={15} frameFor={() => null} />
    );
    await wait(20);
    const base = c.count('/_api/ds/state');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    try {
      await wait(80);
      expect(c.count('/_api/ds/state')).toBe(base);
    } finally {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    }
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')));
    await wait(5);
    expect(c.count('/_api/ds/state')).toBeGreaterThan(base);
  });
});
