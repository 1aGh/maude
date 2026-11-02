// P8 stage C round 8 (p8-c8-ai) — 03 ai-attach: the drop veil covers the thread, not the composer + chips.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

const box = (top: number, bottom: number) =>
  ({ top, bottom, left: 0, right: 300, width: 300, height: bottom - top, x: 0, y: top }) as DOMRect;

describe('drop overlay', () => {
  test('while files hover, the veil stops above the composer', async () => {
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { DropOverlay } = await import('../client/v2/ai/DropOverlay.jsx');
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);
    await act(async () => {
      root.render(
        <div
          data-testid="panel"
          ref={(el) => {
            if (el) el.getBoundingClientRect = () => box(0, 600);
          }}
        >
          <DropOverlay attach={{ addFiles() {} }} />
          <div
            data-testid="chat-composer"
            ref={(el) => {
              if (el) el.getBoundingClientRect = () => box(480, 590);
            }}
          />
        </div>
      );
    });
    const panel = document.querySelector('[data-testid="panel"]') as HTMLElement;
    await act(async () => {
      const ev = new Event('dragenter', { bubbles: true, cancelable: true });
      (ev as unknown as { dataTransfer: unknown }).dataTransfer = { types: ['Files'] };
      panel.dispatchEvent(ev);
    });
    const veil = document.querySelector('[data-testid="ai-attach-drop"]') as HTMLElement;
    expect(veil).not.toBeNull();
    // the composer starts 120 px above the panel's foot: the veil leaves those free, plus an 8 px gap
    expect(veil.style.bottom).toBe('128px');
  });
});
