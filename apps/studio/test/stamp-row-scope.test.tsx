// S4.V4 stamps-1 / stamps-2 - the stamp row and the "N stamps on X" card sit outside `.sh-body--float`
// and the `.maude-v2` scope: the row drew no island material with a mono 400 label, the card fell to the
// browser serif. The row takes the v2 scope and the material itself; the card names its face.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

let registeredHere = false;
beforeAll(async () => {
  if (typeof document === 'undefined') {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    GlobalRegistrator.register();
    registeredHere = true;
  }
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (registeredHere && GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { StampCard } from '../annotations/ui/stamps.tsx';
import StampRow from '../client/v2/annotations/stamp-row.jsx';

async function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    host,
    done: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe('stamp row', () => {
  test('carries the v2 token scope with the shell theme', async () => {
    const shell = document.createElement('div');
    shell.className = 'maude';
    shell.setAttribute('data-theme', 'light');
    document.body.appendChild(shell);
    const { host, done } = await mount(
      <StampRow active="yes" onPickStamp={() => {}} onExpand={() => {}} onClose={() => {}} />
    );
    shell.appendChild(host);
    const row = host.querySelector('[data-testid="tool-panel-stickers"]') as HTMLElement;
    expect(row.classList.contains('maude-v2')).toBe(true);
    expect(row.getAttribute('data-theme')).toBe('light');
    await done();
    shell.remove();
  });

  test('stickers-gallery.css gives the row its own island material and the body face', async () => {
    const css = await Bun.file(
      new URL('../client/v2/annotations/stickers-gallery.css', import.meta.url)
    ).text();
    const rule = css.match(/\.sg-stamprow\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('var(--island-bg');
    expect(rule).toContain('var(--island-shadow');
    expect(rule).toContain('font-family: var(--font-body');
    expect(css).toMatch(/\.sg-stamprow-l\s*\{[^}]*font-weight:\s*var\(--w-semibold\)/);
  });
});

describe('stamp card', () => {
  test('names its own face instead of inheriting the browser serif', async () => {
    const { host, done } = await mount(
      <StampCard cluster={{ count: 0, items: [] } as never} label="Homepage" me={null} />
    );
    const card = host.querySelector('[data-testid="annot-stamp-card"]') as HTMLElement;
    expect(card.getAttribute('style') ?? '').toContain('font-family');
    await done();
  });
});
