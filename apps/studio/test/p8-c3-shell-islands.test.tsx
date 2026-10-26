// P8 C3 — the shell islands: Canvases (left) and Version history (right) hug their content; a canvas row shows a
// twisty only while it is open (hover/focus show it); the panel handle carries its chip (06 ad-pinned); the Undo ·
// Redo · zoom island clears a pinned column; B on the Now row takes the dot's place (11 pn-compare).
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { GRIP_TIP, PanelGrip } from '../client/shell/dock.jsx';

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');
const rule = (css: string, selector: string) => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

describe('01 cf-blank / 11 pn-vh: the panels are content-height islands', () => {
  const css = read('client/v2/shell/floating-panels.css');
  test('the main slot island of Canvases and of Version history does not stretch to the slot', () => {
    for (const panel of ['.st-sidebar', '.vh-panel']) {
      const sel = `.st-body--float .st-dockslot-inner:has(> ${panel})`;
      expect(css).toContain(sel);
      const at = css.indexOf(sel);
      const body = css.slice(css.indexOf('{', at), css.indexOf('}', at));
      expect(body).toContain('flex: 0 1 auto');
      // …also with a chat docked under it (the has-ai rule gives the main island `flex: 1 1 0`)
      expect(css).toContain(`.st-dockslot.has-ai > .st-dockslot-inner:has(> ${panel})`);
    }
  });
});

describe('11 pn-jump: a canvas row has no twisty at rest', () => {
  const css = read('client/v2/canvases/canvases.css');
  test('a closed twisty is transparent until the row is hovered or focused', () => {
    expect(rule(css, '.cv-jt[aria-expanded="false"]')).toContain('opacity: 0');
    expect(css).toContain('.cv-item:hover .cv-jt[aria-expanded="false"]');
    expect(css).toContain('.cv-item:focus-within .cv-jt[aria-expanded="false"]');
  });
});

describe('06 ad-pinned: the handle says what it does', () => {
  test('a tip chip, hidden from assistive tech, with the board words', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const size = { w: 280, setW: () => {}, min: 200, max: 480, def: 280 };
    await act(async () => {
      root?.render((<PanelGrip label="Resize" size={size} onPointerDown={() => {}} />) as never);
    });
    const tip = host.querySelector('.st-grip-tip');
    expect(tip?.textContent).toBe('Drag · double-click resets · ← → move 8');
    expect(tip?.getAttribute('aria-hidden')).toBe('true');
    expect(GRIP_TIP).toBe(tip?.textContent);
  });
  test('it shows only while the handle is held or focused', () => {
    const css = read('client/v2/shell/floating-panels.css');
    expect(rule(css, '.st-grip-tip')).toContain('opacity: 0');
    expect(css).toContain('.st-grip.is-active .st-grip-tip');
    expect(css).toContain('.st-grip:focus-visible .st-grip-tip');
  });
});

describe('06 ad-pinned: the bottom-left island sits in the canvas column', () => {
  test('pinned with a Canvases column open, the island starts after it', () => {
    const css = read('client/v2/preview/preview.css');
    expect(css).toContain(
      '.st-body:not(.st-body--float):has(> .st-dockslot--left:not(.is-collapsed):not(.is-hidden)) .sh-zoomundo.island'
    );
    expect(css).toContain('left: calc(var(--sb-w, 0px) + var(--float-gap, 16px))');
  });
  test('a folded panel icon stands beside a pinned column, not over its header (a11y V4)', () => {
    const css = read('client/v2/shell/floating-panels.css');
    const sel =
      '.st-body:not(.st-body--float):has(> .st-dockslot--right:not(.is-collapsed):not(.is-hidden)) .sh-corner--right';
    expect(css).toContain(sel);
    const at = css.indexOf(sel);
    expect(css.slice(css.indexOf('{', at), css.indexOf('}', at))).toContain(
      'right: calc(var(--rp-w, 0px) + 16px)'
    );
  });
});
