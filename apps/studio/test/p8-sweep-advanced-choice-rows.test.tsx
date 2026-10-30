// p8-sweep-advanced — the dead-control crawl clicked three menu rows that could only repeat what the control
// already showed: "None" on a colour with nothing written, "None" on a length with nothing written, and
// "A number, no token…" on a length that already is a number. A row that names the current choice is a checked
// radio (the way the token stops already are): it says "this is the one", and a checked row is not a button
// that does nothing.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});
async function mount(el: React.ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(el));
  return host;
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: Element | null) =>
  act(async () => {
    el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });

const TOKENS = { space: [{ name: '--space-1', px: 8 }] };

describe('LengthControl rows that name the current choice', () => {
  test('"None" is the checked row while nothing is written', async () => {
    const { LengthControl } = await import('../client/v2/inspector/token-chip.jsx');
    const changes: unknown[] = [];
    const host = await mount(
      <LengthControl
        name="corners"
        label="Corners"
        value={null}
        tokens={TOKENS}
        allowNone
        onChange={(v: unknown) => changes.push(v)}
      />
    );
    await click(host.querySelector('button.insp-chip'));
    const none = q(host, 'insp-none-corners');
    expect(none?.getAttribute('role')).toBe('menuitemradio');
    expect(none?.getAttribute('aria-checked')).toBe('true');
  });

  test('"None" is a real choice (not checked) once a value is written, and removes it', async () => {
    const { LengthControl } = await import('../client/v2/inspector/token-chip.jsx');
    const changes: unknown[] = [];
    const host = await mount(
      <LengthControl
        name="corners"
        label="Corners"
        value={{ token: '--space-1', px: 8 }}
        tokens={TOKENS}
        allowNone
        onChange={(v: unknown) => changes.push(v)}
      />
    );
    await click(host.querySelector('button.insp-chip'));
    const none = q(host, 'insp-none-corners');
    expect(none?.getAttribute('aria-checked')).toBe('false');
    await click(none);
    expect(changes).toEqual([null]);
  });

  test('"A number, no token…" is the checked row while the number field is showing', async () => {
    const { LengthControl } = await import('../client/v2/inspector/token-chip.jsx');
    const host = await mount(
      <LengthControl
        name="pad-all"
        label="Padding"
        value={{ px: 10 }}
        tokens={TOKENS}
        onChange={() => {}}
      />
    );
    await click(host.querySelector('button.insp-chip-more'));
    const num = q(host, 'insp-number-pad-all');
    expect(num?.getAttribute('role')).toBe('menuitemradio');
    expect(num?.getAttribute('aria-checked')).toBe('true');
  });

  test('"A number, no token…" still switches a token to a number', async () => {
    const { LengthControl } = await import('../client/v2/inspector/token-chip.jsx');
    const changes: unknown[] = [];
    const host = await mount(
      <LengthControl
        name="pad-all"
        label="Padding"
        value={{ token: '--space-1', px: 8 }}
        tokens={TOKENS}
        onChange={(v: unknown) => changes.push(v)}
      />
    );
    await click(host.querySelector('button.insp-chip'));
    const num = q(host, 'insp-number-pad-all');
    expect(num?.getAttribute('aria-checked')).toBe('false');
    await click(num);
    expect(changes).toEqual([{ px: 8 }]);
  });
});

describe('ColorControl "None"', () => {
  test('is the checked row while nothing is written', async () => {
    const { ColorControl } = await import('../client/v2/inspector/sections/color-control.jsx');
    const host = await mount(
      <ColorControl
        name="fill"
        label="Fill"
        value={null}
        colors={['--ink']}
        allowNone
        onChange={() => {}}
      />
    );
    await click(host.querySelector('button.insp-chip'));
    const none = q(host, 'insp-none-fill');
    expect(none?.getAttribute('role')).toBe('menuitemradio');
    expect(none?.getAttribute('aria-checked')).toBe('true');
  });

  test('removes a written fill', async () => {
    const { ColorControl } = await import('../client/v2/inspector/sections/color-control.jsx');
    const changes: unknown[] = [];
    const host = await mount(
      <ColorControl
        name="fill"
        label="Fill"
        value={{ paint: { token: '--ink' }, opacity: 100 }}
        colors={['--ink']}
        allowNone
        onChange={(v: unknown) => changes.push(v)}
      />
    );
    await click(host.querySelector('button.insp-chip'));
    const none = q(host, 'insp-none-fill');
    expect(none?.getAttribute('aria-checked')).toBe('false');
    await click(none);
    expect(changes).toEqual([null]);
  });
});
