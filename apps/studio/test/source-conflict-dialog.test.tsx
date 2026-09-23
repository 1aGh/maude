import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import SourceConflictPanel from '../client/panels/SourceConflictPanel.jsx';

// View fixture only: actual acceptance/storage is covered by the projection
// and real-hub suites. A local HTTP service supplies the conflict API shape.
const sides = {
  ok: true,
  slug: 'fixture',
  original: '<h1>Unfinished',
  base: '<h1>Base</h1>',
  mine: '<h1>Unfinished repaired</h1>',
  theirs: '<h1 style="color:red">Base</h1>',
};
const NativeResponse = globalThis.Response;
const service = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch: () => NativeResponse.json(sides),
});
beforeAll(() => {
  GlobalRegistrator.register({ url: String(service.url) });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
  service.stop(true);
});

async function mount() {
  const trigger = document.createElement('button');
  trigger.textContent = 'Resolve';
  const host = document.createElement('div');
  document.body.append(trigger, host);
  trigger.focus();
  const root = createRoot(host);
  let closed = 0;
  await act(async () =>
    root.render(
      <SourceConflictPanel
        slug="fixture"
        onClose={() => {
          closed++;
        }}
      />
    )
  );
  for (let i = 0; i < 100 && !host.querySelector('[data-testid="source-conflict-diff"]'); i++)
    await act(async () => {
      await Bun.sleep(10);
    });
  return {
    host,
    trigger,
    get closed() {
      return closed;
    },
    async close() {
      await act(async () => root.unmount());
      const restored = document.activeElement === trigger;
      host.remove();
      trigger.remove();
      return restored;
    },
  };
}

test('conflict modal wraps keyboard focus, dismisses with Escape and restores the opener', async () => {
  const f = await mount();
  let restored = false;
  try {
    const first = f.host.querySelector<HTMLButtonElement>('[data-testid="source-conflict-close"]');
    const last = f.host.querySelector<HTMLButtonElement>(
      '[data-testid="source-conflict-use-theirs"]'
    );
    expect(first).not.toBeNull();
    expect(last).not.toBeNull();
    expect(document.activeElement).toBe(first);
    const back = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      first?.dispatchEvent(back);
    });
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    const forward = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    await act(async () => {
      last?.dispatchEvent(forward);
    });
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
    await act(async () => {
      first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(f.closed).toBe(1);
  } finally {
    restored = await f.close();
  }
  expect(restored).toBe(true);
});

test('conflict view exposes the exact original draft and proven starting version separately from current sides', async () => {
  const f = await mount();
  try {
    expect(f.host.querySelector('[data-testid="source-conflict-original"]')?.textContent).toBe(
      sides.original
    );
    expect(f.host.querySelector('[data-testid="source-conflict-base"]')?.textContent).toBe(
      sides.base
    );
    expect(f.host.querySelector('[data-testid="source-conflict-diff"]')?.textContent).toContain(
      sides.mine
    );
    expect(f.host.querySelector('[data-testid="source-conflict-diff"]')?.textContent).toContain(
      sides.theirs
    );
  } finally {
    await f.close();
  }
});
