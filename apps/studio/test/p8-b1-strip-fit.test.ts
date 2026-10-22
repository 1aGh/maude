// P8 bug sweep B1 — the tab strip counted "N more" twice. `.tabs` is narrower by the button whenever it shows, and
// fit() takes the button's room off again: the first draw (button hidden) fitted four tabs, the next draw (a resize,
// any push from Rust) three — a tab vanished into "N more" a moment after it was drawn, and the row always left a
// tab's width empty. Measured here with fake geometry: happy-dom has no layout.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const SRC = join(import.meta.dir, '..', '..', 'desktop', 'src');
const HTML = readFileSync(join(SRC, 'strip.html'), 'utf8');
const JS = readFileSync(join(SRC, 'strip.js'), 'utf8');

beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());

const tab = (i: number) => ({
  label: `p-l${String(i).padStart(16, '0')}`,
  kind: 'project',
  name: `Project ${i}`,
  dot: null,
  resting: false,
  closing: false,
  initial: 'P',
  tone: 'sky',
  account: null,
  place: 'mac',
});

const tick = () => new Promise((r) => setTimeout(r, 0));

/** The strip row: `ROW` px for the tabs when "N more" is hidden; the button (88 px + 8 of margin) takes its room
 *  out of `.tabs` when it shows — what flex does. */
const ROW = 600;
const MORE_BOX = 88;

async function mountRow(n: number) {
  const body = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<script src="strip.js">'));
  document.body.innerHTML = body;
  const tabs = document.getElementById('tabs') as HTMLElement;
  const more = document.getElementById('more') as HTMLElement;
  Object.defineProperty(tabs, 'clientWidth', {
    configurable: true,
    get: () => ROW - (more.hidden ? 0 : MORE_BOX + 8),
  });
  Object.defineProperty(more, 'offsetWidth', { configurable: true, get: () => MORE_BOX });
  let push: (s: unknown) => void = () => {};
  const state = { tabs: Array.from({ length: n }, (_, i) => tab(i + 1)), home: { label: 'home' } };
  (window as unknown as Record<string, unknown>).__TAURI__ = {
    core: {
      Channel: class {
        onmessage: ((s: unknown) => void) | null = null;
      },
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        if (cmd === 'tabs_state') {
          const ch = args?.onState as { onmessage: (s: unknown) => void };
          push = (s) => ch.onmessage(s);
          return Promise.resolve({ ...state, active: state.tabs[0].label, overview: false });
        }
        return Promise.resolve();
      },
    },
  };
  new Function(JS)();
  await tick();
  const shown = () => document.querySelectorAll('#tabs .tab').length;
  return {
    shown,
    moreText: () => more.textContent,
    redraw: async () => {
      push({ ...state, active: state.tabs[0].label, overview: false });
      await tick();
    },
  };
}

describe('P8 B1 — the tab row fits the same tabs on every draw', () => {
  test('600 px, 8 tabs: four fit (cap = (600 − 88) ÷ 120) now and after the next draw', async () => {
    const row = await mountRow(8);
    expect(row.shown()).toBe(4);
    expect(row.moreText()).toBe('4 more');
    await row.redraw();
    expect(row.shown()).toBe(4); // it was 3 — and "5 more" — once the button had shrunk the row
    expect(row.moreText()).toBe('4 more');
    await row.redraw();
    expect(row.shown()).toBe(4);
  });

  test('everything that fits stays out of "N more"', async () => {
    const row = await mountRow(4); // 4 × 120 = 480 ≤ 600
    expect(row.shown()).toBe(4);
    expect((document.getElementById('more') as HTMLElement).hidden).toBe(true);
  });
});
