// P8 fidelity (Michal, 2026-10-29) — the "Design systems" menu of Preview in … could not be closed, and said
// "in use" for a different system than the Canvases panel did. Pinned here, against the real bar:
//   (a) esc stops it and puts focus back on the row it was opened from
//   (b) a pointerdown anywhere outside the menu closes the menu (the banner and the preview stay)
//   (c) a click into the canvas iframe (a different origin: nothing bubbles) closes it through the shell
//       window's `blur` — the pattern the project pill uses
//   (d) a second request from the same row toggles it off; from a hidden menu it brings the menu back
//   copy: the menu marks the system THIS canvas uses and the default for new canvases, never the bare "in use"
//         the panel's "2 in use" already means something else by

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  beginDsPreview,
  getDsPreview,
  hideDsPreviewMenu,
  requestPreviewMenu,
  resetDsPreview,
} from '../client/v2/ds/preview-mode.js';

let Live: (p: Record<string, unknown>) => unknown;
const roots: Root[] = [];
beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const { DsPreviewBar } = await import('../client/v2/ds/preview-bar.jsx');
  const { useDsPreview } = await import('../client/v2/ds/preview-mode.js');
  const React = await import('react');
  Live = (props) => {
    const session = useDsPreview();
    return session
      ? React.createElement(DsPreviewBar as never, { session, ...props } as never)
      : null;
  };
});
afterAll(() => GlobalRegistrator.unregister());
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  resetDsPreview();
});

const LABELS: Record<string, string> = { gator: 'maude', studio: 'maude-v2' };
const SYSTEMS = ['gator', 'studio'];

async function mount(over: Record<string, unknown> = {}) {
  // the Canvases panel's row, as the tree draws it (the menu's opener) and a bit of shell around it
  document.body.innerHTML = `
    <div data-testid="canvases-pinned">
      <button data-testid="canvases-ds-row" data-ds="studio">maude-v2</button>
      <button data-testid="canvases-ds-row-menu" data-ds="studio">⋯</button>
      <button data-testid="canvases-ds-row-menu" data-ds="gator">⋯</button>
    </div>
    <div data-testid="shell-elsewhere">elsewhere</div>`;
  beginDsPreview({ from: 'studio', systems: SYSTEMS });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      (
        <Live
          labelOf={(n: string) => LABELS[n] ?? n}
          shown={5}
          onSwitch={() => undefined}
          {...over}
        />
      ) as never
    )
  );
  return host;
}
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const rowMenu = (ds: string) =>
  [...document.querySelectorAll<HTMLElement>('[data-testid="canvases-ds-row-menu"]')].find(
    (b) => b.getAttribute('data-ds') === ds
  ) as HTMLElement;
const down = async (el: Element | Window | Document) =>
  act(async () => {
    el.dispatchEvent(new window.Event('pointerdown', { bubbles: true, cancelable: true }));
  });
const key = async (el: Element | Window, k: string) =>
  act(async () => {
    el.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
    );
  });

describe('(a) esc', () => {
  test('esc in the menu stops the preview and focus goes back to the row it was opened from', async () => {
    await mount();
    expect(document.activeElement).toBe(q('ds-preview-menu'));
    await key(q('ds-preview-menu') as HTMLElement, 'Escape');
    expect(getDsPreview()).toBeNull();
    expect(q('ds-preview-menu')).toBeNull();
    expect(document.activeElement).toBe(rowMenu('studio'));
  });

  test('esc from anywhere (the menu lost focus) does the same', async () => {
    await mount();
    rowMenu('gator').focus();
    await key(window, 'Escape');
    expect(getDsPreview()).toBeNull();
    expect(document.activeElement).toBe(rowMenu('studio'));
  });
});

describe('(b) a click outside', () => {
  test('closes the menu, keeps the banner and the preview; a click inside the menu does not close it', async () => {
    await mount();
    await down(q('ds-preview-option') as HTMLElement);
    expect(q('ds-preview-menu')).not.toBeNull();
    await down(q('shell-elsewhere') as HTMLElement);
    expect(q('ds-preview-menu')).toBeNull();
    expect(q('ds-preview-banner')).not.toBeNull();
    expect(getDsPreview()).not.toBeNull();
    // esc still steps all the way back
    await key(window, 'Escape');
    expect(getDsPreview()).toBeNull();
  });

  test('the banner’s Switch… still works once the menu is gone', async () => {
    const switched: string[] = [];
    await mount({ onSwitch: (t: string) => switched.push(t) });
    const sw = q('ds-preview-switch') as HTMLElement;
    await down(sw);
    expect(q('ds-preview-menu')).toBeNull();
    await act(async () => {
      sw.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(switched).toEqual(['gator']);
  });
});

describe('(c) a click into the canvas iframe', () => {
  test('the iframe takes focus from the shell window: window blur closes the menu', async () => {
    await mount();
    expect(q('ds-preview-menu')).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new window.Event('blur'));
    });
    expect(q('ds-preview-menu')).toBeNull();
    expect(q('ds-preview-banner')).not.toBeNull();
  });
});

describe('(d) the row again', () => {
  test('a pointerdown on the row it opened from closes the menu', async () => {
    await mount();
    await down(rowMenu('studio'));
    expect(q('ds-preview-menu')).toBeNull();
  });

  test('asking again from the same row toggles it: open → stopped; hidden → shown; another row → restarts', () => {
    expect(requestPreviewMenu({ from: 'studio', systems: SYSTEMS })).toBe('started');
    expect(requestPreviewMenu({ from: 'studio', systems: SYSTEMS })).toBe('stopped');
    expect(getDsPreview()).toBeNull();
    requestPreviewMenu({ from: 'studio', systems: SYSTEMS });
    hideDsPreviewMenu();
    expect(getDsPreview()?.menuOpen).toBe(false);
    expect(requestPreviewMenu({ from: 'studio', systems: SYSTEMS })).toBe('shown');
    expect(getDsPreview()?.menuOpen).toBe(true);
    expect(requestPreviewMenu({ from: 'gator', systems: SYSTEMS })).toBe('started');
    expect(getDsPreview()?.from).toBe('gator');
  });

  test('a second row set with fewer than two systems starts nothing', () => {
    expect(requestPreviewMenu({ from: 'studio', systems: ['studio'] })).toBe('none');
  });
});

describe('copy: the panel and the menu say the same thing', () => {
  const notes = () =>
    Object.fromEntries(
      [...document.querySelectorAll('[data-testid="ds-preview-option"]')].map((o) => [
        o.getAttribute('data-ds'),
        o.querySelector('em')?.textContent ?? '',
      ])
    );

  test('the system THIS canvas uses and the default for new canvases are named in words', async () => {
    await mount({ usedBy: 'studio', defaultName: 'gator' });
    // highlight starts on the system after the row's own: gator
    expect(notes().studio).toBe('used by this canvas');
    expect(notes().gator).toContain('default for new canvases');
  });

  test('"in use" is the panel’s word for a system some canvas uses; the menu never says it bare', async () => {
    await mount({ usedBy: 'studio', defaultName: 'gator' });
    expect(q('ds-preview-menu')?.textContent).not.toMatch(/\bin use\b/);
  });

  test('no canvas open: nothing is marked as this canvas’s', async () => {
    await mount({ usedBy: null, defaultName: 'gator' });
    expect(notes().studio).not.toContain('used by this canvas');
  });
});

// P8 fidelity (Michal: "every button must do something") — the three doors at the foot of the menu run the registry
// actions the Canvases panel and ⌘K already run (one path), or are greyed with the reason; none is a dead row.
describe('the doors at the foot', () => {
  type Ran = [string, unknown];
  const doorProps = (ran: Ran[], over: Record<string, unknown> = {}) => ({
    runAction: (id: string, params: unknown) => {
      ran.push([id, params]);
      return true;
    },
    canRunAction: () => true,
    ...over,
  });
  const door = (id: string) =>
    document.querySelector<HTMLElement>(
      `[data-testid="ds-preview-door"][data-door="${id}"]`
    ) as HTMLElement;
  const click = (el: Element) =>
    act(async () => {
      el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });

  test('Open the Design system goes to the system the menu was opened from, and the preview ends', async () => {
    const ran: Ran[] = [];
    await mount(doorProps(ran));
    await click(door('open'));
    expect(ran).toEqual([['ds.go-to', { ds: 'studio' }]]);
    expect(getDsPreview()).toBeNull();
  });

  test('Make a design system runs ds.make and closes the menu (the sheet is not a navigation: the banner stays)', async () => {
    const ran: Ran[] = [];
    await mount(doorProps(ran));
    await click(door('make'));
    expect(ran).toEqual([['ds.make', {}]]);
    expect(q('ds-preview-menu')).toBeNull();
    expect(getDsPreview()).not.toBeNull();
  });

  test('Link a team library runs ds.library-link and closes the menu', async () => {
    const ran: Ran[] = [];
    await mount(doorProps(ran));
    await click(door('link'));
    expect(ran).toEqual([['ds.library-link', {}]]);
    expect(q('ds-preview-menu')).toBeNull();
    expect(getDsPreview()).not.toBeNull();
  });

  test('↵ on Open the Design system runs it (and does not switch)', async () => {
    const ran: Ran[] = [];
    const switched: string[] = [];
    await mount(doorProps(ran, { onSwitch: (t: string) => switched.push(t) }));
    await key(door('open'), 'Enter');
    expect(ran).toEqual([['ds.go-to', { ds: 'studio' }]]);
    expect(switched).toEqual([]);
  });

  test('↵ on the list (not on a door) still opens the switch review', async () => {
    const ran: Ran[] = [];
    const switched: string[] = [];
    await mount(doorProps(ran, { onSwitch: (t: string) => switched.push(t) }));
    await key(q('ds-preview-menu') as HTMLElement, 'Enter');
    expect(switched).toEqual(['gator']);
    expect(ran).toEqual([]);
  });

  test('a viewer: Make and Link are greyed with the reason and do nothing; Open still works', async () => {
    const ran: Ran[] = [];
    await mount(doorProps(ran, { readOnly: true }));
    for (const id of ['make', 'link']) {
      expect(door(id).getAttribute('aria-disabled')).toBe('true');
      expect(door(id).getAttribute('aria-description')).toMatch(/edit access/);
      expect(door(id).getAttribute('title')).toMatch(/edit access/);
      await click(door(id));
      await key(door(id), 'Enter');
    }
    expect(ran).toEqual([]);
    expect(q('ds-preview-menu')).not.toBeNull();
    expect(door('open').getAttribute('aria-disabled')).toBeNull();
    await click(door('open'));
    expect(ran).toEqual([['ds.go-to', { ds: 'studio' }]]);
  });

  test('a door whose action has no runner here is greyed and says so', async () => {
    const ran: Ran[] = [];
    await mount(doorProps(ran, { canRunAction: (id: string) => id !== 'ds.library-link' }));
    expect(door('link').getAttribute('aria-disabled')).toBe('true');
    expect(door('link').getAttribute('aria-description')).toMatch(/not available/i);
    await click(door('link'));
    expect(ran).toEqual([]);
  });

  test('a bar mounted with no runner at all has no clickable door', async () => {
    await mount();
    for (const id of ['open', 'make', 'link'])
      expect(door(id).getAttribute('aria-disabled')).toBe('true');
  });
});
