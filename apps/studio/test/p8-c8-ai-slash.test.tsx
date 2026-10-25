// P8 stage C round 8 (p8-c8-ai) — 03 ai-adv-edges: the slash menu hangs from the composer's own rectangle
// (fixed), so a short chat's dock slot cannot cut it to one row.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

describe('slash menu placement', () => {
  test('fixed, as wide as the composer, sitting just above it', async () => {
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { CommandPopover } = await import('../client/v2/ai/Composer.jsx');
    const host = document.createElement('div');
    host.getBoundingClientRect = () =>
      ({ left: 40, top: 700, right: 340, bottom: 740, width: 300, height: 40, x: 40, y: 700 }) as DOMRect;
    document.body.append(host);
    const root = createRoot(host);
    const items = [
      { name: 'design:critic', note: 'Review this canvas', group: 'design' },
      { name: 'design:edit', note: 'Change the selection', group: 'design' },
    ];
    await act(async () => {
      root.render(
        <CommandPopover items={items} activeIndex={0} onPick={() => {}} onHover={() => {}} />
      );
    });
    const menu = document.querySelector('[data-testid="chat-cmd-menu"]') as HTMLElement;
    expect(menu.style.position).toBe('fixed');
    expect(menu.style.left).toBe('40px');
    expect(menu.style.width).toBe('300px');
    expect(menu.style.bottom).toBe(`${window.innerHeight - 700 + 4}px`);
  });
});
