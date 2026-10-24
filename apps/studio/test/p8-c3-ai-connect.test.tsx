// P8 stage C round 3 (02 ob-ai-connect, 05 es-canvas-three): the Connect sheet is a centred card over a strong veil.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

describe('ConnectModal', () => {
  test('lands in the document body as a dialog over the veil; focus is on Connect; Esc is Cancel; the veil is not', async () => {
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { ConnectModal } = await import('../client/v2/ai/ConnectSheet.jsx');
    const calls: string[] = [];
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <ConnectModal
          phase="idle"
          onConnect={() => calls.push('connect')}
          onCancel={() => calls.push('cancel')}
        />
      )
    );
    const veil = document.querySelector('.ai-conn-veil') as HTMLElement;
    expect(veil).not.toBeNull();
    // not inside the host (the panel): a portal, so no ancestor can clip or pin it
    expect(host.contains(veil)).toBe(false);
    const sheet = veil.querySelector('[data-testid="ai-connect-sheet"]') as HTMLElement;
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(veil.querySelector('[data-testid="ai-connect-go"]'));
    // a click on the veil is not Cancel (Cancel drops the kept prompt)
    await act(async () => veil.click());
    expect(calls).toEqual([]);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(calls).toEqual(['cancel']);
  });

  test('the veil is the canvas ground at 72 %, centred, above the app (kit .k-veil--strong)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(import.meta.dir, '../client/v2/ai/needs-you.css'), 'utf8');
    const rule = /\.ai-conn-veil \{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(rule).toContain('position: fixed');
    expect(rule).toContain('place-items: center');
    expect(rule).toContain('var(--canvas-bg) 72%');
  });
});
