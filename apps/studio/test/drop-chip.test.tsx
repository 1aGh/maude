// S7.9 (07 · ve-drop) — the canvas half of "drop footage on the artboard": while footage is in flight over the window the
// shell sends `timeline-drop-hint` and the followed video wears the chip "Or drop here — adds at the end". The canvas only
// draws; the drop itself is the shell's, so nothing here reads a file.

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

import { acceptFromShell } from '../bridge/dgn-protocol.ts';
import { artboardBox, DROP_CHIP_TEXT, DropChip, nextDropHint } from '../editing/drop-chip.tsx';

describe('the hint', () => {
  test('on shows the chip on that artboard; off takes it down; a late off for another artboard does not', () => {
    expect(nextDropHint(null, { artboardId: 'reel', on: true })).toBe('reel');
    expect(nextDropHint('reel', { artboardId: 'reel', on: false })).toBeNull();
    expect(nextDropHint('wide', { artboardId: 'reel', on: false })).toBe('wide');
    expect(nextDropHint('reel', { artboardId: 'wide', on: true })).toBe('wide');
  });

  test('the chip says what it does (07 · ve-drop)', () => {
    expect(DROP_CHIP_TEXT).toBe('Or drop here — adds at the end');
  });

  test('only the shell can send it, and only well-formed', () => {
    const parent = {} as Window;
    const win = { parent } as unknown as Window;
    const ev = (data: unknown, source: unknown) => ({ data, source }) as unknown as MessageEvent;
    const good = { dgn: 'timeline-drop-hint', artboardId: 'reel', on: true };
    expect(acceptFromShell(ev(good, parent), win)).toEqual(good);
    expect(acceptFromShell(ev(good, {}), win)).toBeNull(); // not the shell
    expect(acceptFromShell(ev({ ...good, on: 'yes' }, parent), win)).toBeNull();
    expect(acceptFromShell(ev({ dgn: 'timeline-drop-hint', on: true }, parent), win)).toBeNull();
  });
});

describe('the chip on the artboard', () => {
  function artboard(id: string, w = 238, h = 422) {
    const el = document.createElement('div');
    el.setAttribute('data-dc-screen', id);
    const body = document.createElement('div');
    body.className = 'dc-artboard-body';
    body.getBoundingClientRect = () =>
      ({ left: 120, top: 60, width: w, height: h, right: 0, bottom: 0, x: 120, y: 60 }) as DOMRect;
    el.appendChild(body);
    document.body.appendChild(el);
    return el;
  }

  test('the box is the artboard’s design surface; an undrawn or empty one has none', () => {
    const el = artboard('reel');
    expect(artboardBox(document, 'reel')).toEqual({ left: 120, top: 60, width: 238, height: 422 });
    expect(artboardBox(document, 'nope')).toBeNull();
    el.remove();
    const flat = artboard('flat', 0, 0);
    expect(artboardBox(document, 'flat')).toBeNull();
    flat.remove();
  });

  test('a hint from the shell draws the chip over that artboard, and off removes it', async () => {
    const el = artboard('reel');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<DropChip />));
    const send = async (on: boolean) => {
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { dgn: 'timeline-drop-hint', artboardId: 'reel', on },
            source: window.parent,
          })
        );
      });
    };
    // happy-dom's window.parent is the window itself when there is no frame — the shell gate is what matters here
    await send(true);
    const chip = host.querySelector('[data-testid="edit-drop-chip"]') as HTMLElement | null;
    expect(chip?.textContent).toBe(DROP_CHIP_TEXT);
    expect(chip?.style.width).toBe('238px');
    await send(false);
    expect(host.querySelector('[data-testid="edit-drop-chip"]')).toBeNull();
    await act(async () => root.unmount());
    host.remove();
    el.remove();
  });
});
