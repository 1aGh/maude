// Phase 8 C1-kit — every "› Advanced" fold is the kit fold row (06 Advanced `Fold`, _kit.css `.k-adv*`):
// the kit classes on every fold whatever the panel's own classes, the `submenu` "›" (not chevron-right),
// the "what's inside" hint ONLY while closed (06 Advanced.tsx:317 `!open && hint`), and — while open by a
// remembered choice — the "kept open" pin (06 ad-left / ad-history / ad-pinned / ad-edge-remember).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

describe('the kit fold row', () => {
  const realFetch = globalThis.fetch;
  const roots: Root[] = [];
  let AdvancedFold: typeof import('../client/v2/fold/advanced-fold.jsx').AdvancedFold;
  let foldStore: typeof import('../client/v2/fold/use-fold.js').foldStore;

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    ({ AdvancedFold } = await import('../client/v2/fold/advanced-fold.jsx'));
    ({ foldStore } = await import('../client/v2/fold/use-fold.js'));
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    GlobalRegistrator.unregister();
  });
  beforeEach(() => {
    globalThis.fetch = (async () =>
      new Response('{"ok":true}', { status: 200 })) as unknown as typeof fetch;
    foldStore.reset();
  });
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
  });

  async function mount(el: React.ReactElement) {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(el));
    return host;
  }
  const click = (el: Element | null) =>
    act(async () => {
      el?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });

  test('kit classes on every part, also when a panel passes its own', async () => {
    const host = await mount(
      <AdvancedFold
        panel="left.canvases"
        hint="Files, folder, Trash"
        classes={{ root: 'lp-adv', btn: 'lp-adv-btn', ch: 'lp-adv-ch', body: 'lp-adv-body' }}
      >
        <p>inside</p>
      </AdvancedFold>
    );
    const root = host.querySelector('[data-fold="left.canvases"]');
    expect(root?.classList.contains('k-adv')).toBe(true);
    expect(root?.classList.contains('lp-adv')).toBe(true);
    const btn = root?.querySelector('button');
    expect(btn?.classList.contains('k-adv-btn')).toBe(true);
    expect(btn?.querySelector('.k-adv-ch')).not.toBeNull();
    expect(btn?.querySelector('.k-adv-count')?.textContent).toBe('Files, folder, Trash');
    await click(btn ?? null);
    expect(root?.querySelector('.k-adv-body')).not.toBeNull();
  });

  test('the hint says what is inside only while closed', async () => {
    const host = await mount(
      <AdvancedFold panel="history" hint="Branch, git, changed files">
        <p>inside</p>
      </AdvancedFold>
    );
    expect(host.textContent).toContain('Branch, git, changed files');
    await click(host.querySelector('button'));
    expect(host.textContent).not.toContain('Branch, git, changed files');
  });

  test('open by a remembered choice shows the "kept open" pin; closed or default-open does not', async () => {
    const host = await mount(
      <AdvancedFold panel="history" hint="Branch">
        <p>inside</p>
      </AdvancedFold>
    );
    expect(host.querySelector('.ad-kept')).toBeNull();
    await click(host.querySelector('button'));
    const pin = host.querySelector('.ad-kept');
    expect(pin?.textContent).toBe('kept open');
    expect(pin?.getAttribute('title')).toBe('Stays open next time');
    await click(host.querySelector('button'));
    expect(host.querySelector('.ad-kept')).toBeNull();
  });

  test('the "›" is the kit submenu glyph (a path, not the old chevron-right polyline)', async () => {
    const host = await mount(<AdvancedFold panel="code">x</AdvancedFold>);
    const ch = host.querySelector('.k-adv-ch svg');
    expect(ch?.querySelector('path')?.getAttribute('d')).toBe('M6 4.5l3.5 3.5L6 11.5');
  });
});
