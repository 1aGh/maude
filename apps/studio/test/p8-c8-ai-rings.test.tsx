// P8 stage C round 8 (p8-c8-ai) — 03 ai-permission: while an ask waits on you, every artboard it would change
// wears a "will change" chip and the group of them one tag ("Waiting for you", with the count) instead of one
// tag each. Fixed words only (DDR-054: nothing of the ask reaches the canvas).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const rect = (left: number, top: number, width = 100, height = 140) =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
  }) as DOMRect;

async function overlay(ids: string[]) {
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const mod = await import('../artboard-activity-overlay.tsx');
  mod.landing.graceMs = 0;
  sessionStorage.clear();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<mod.ArtboardRingsLayer />);
  });
  ids.forEach((id, i) => {
    const b = document.createElement('div');
    b.setAttribute('data-dc-screen', id);
    b.getBoundingClientRect = () => rect(100 + i * 130, 200);
    document.body.append(b);
  });
  return { act };
}
const post = (data: unknown) =>
  window.dispatchEvent(new MessageEvent('message', { data, source: window as never }));
const needs = { state: 'needs-you', who: 'you', tag: 'Waiting for you', waiting: 0 };

describe('ai-permission rings', () => {
  test('every needs-you artboard carries a "will change" chip', async () => {
    const { act } = await overlay(['a', 'b']);
    await act(async () => {
      post({ dgn: 'ai-runs', artboards: { a: needs, b: needs } });
    });
    for (const id of ['a', 'b']) {
      expect(q(`ai-ring-${id}`)?.querySelector('.dc-ai-will')?.textContent).toBe('will change');
    }
  });

  test('two or more waiting artboards share ONE tag with the count; their own tags go quiet', async () => {
    const { act } = await overlay(['a', 'b', 'c']);
    await act(async () => {
      post({ dgn: 'ai-runs', artboards: { a: needs, b: needs, c: needs } });
    });
    const g = q('ai-ring-group');
    expect(g).not.toBeNull();
    expect(g?.textContent).toBe('Waiting for you · 3 artboards');
    for (const id of ['a', 'b', 'c'])
      expect(q(`ai-ring-${id}`)?.getAttribute('data-grouped')).toBe('true');
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    // the group box wraps the three rectangles (100..460 wide, plus the ring's 5 px)
    const style = g?.getAttribute('style') ?? '';
    expect(style).toContain('left: 95px');
    expect(style).toContain('width: 370px');
  });

  test('one waiting artboard keeps its own tag, no group', async () => {
    const { act } = await overlay(['a']);
    await act(async () => {
      post({ dgn: 'ai-runs', artboards: { a: needs } });
    });
    expect(q('ai-ring-group')).toBeNull();
    expect(q('ai-ring-a')?.textContent).toContain('Waiting for you');
    expect(q('ai-ring-a')?.hasAttribute('data-grouped')).toBe(false);
  });
});
